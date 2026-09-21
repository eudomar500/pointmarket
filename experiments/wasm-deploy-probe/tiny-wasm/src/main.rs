//! Minimal raw WASM contract for GenLayer, no_std edition.
//!
//! Purpose: answer whether Testnet Bradbury loads and executes a raw WASM
//! contract. The earlier std build worked and was correct, but at 26 685 bytes
//! it needed about 21.9M gas to deploy, and Bradbury caps a transaction at
//! 2^24 = 16 777 216 gas. Deploy gas here is dominated by calldata, so the only
//! way under the cap is a smaller module. This version is `#![no_std]` with a
//! entry point of its own and no allocator.
//!
//! The observable surface is deliberately unchanged from the std build, so the
//! experiment stays comparable:
//!   * imports `genlayer_sdk::gl_call` with the wasm type `(i32,i32,i32)->(i32)`,
//!     the same type the pinned CPython runner imports;
//!   * imports exactly `wasi_snapshot_preview1::{fd_read, fd_write, environ_get,
//!     environ_sizes_get, proc_exit}`, matching `verifier.wasm`;
//!   * exports `memory`, `_start` and `__main_void`;
//!   * same stdout marker and same `{"Return": ...}` payload.
//!
//! The std version is kept verbatim in `main_std_reference.rs.txt` for the
//! record. It is not compiled.

#![no_std]
#![no_main]

use core::panic::PanicInfo;

#[repr(C)]
struct Ciovec {
    buf: *const u8,
    buf_len: u32,
}

// Same import module, name and signature as the tls verifier uses.
#[link(wasm_import_module = "genlayer_sdk")]
extern "C" {
    fn gl_call(request: *const u8, request_len: u32, result_fd: *mut u32) -> u32;
}

#[link(wasm_import_module = "wasi_snapshot_preview1")]
extern "C" {
    fn fd_read(fd: u32, iovs: *const Ciovec, iovs_len: u32, nread: *mut u32) -> u32;
    fn fd_write(fd: u32, iovs: *const Ciovec, iovs_len: u32, nwritten: *mut u32) -> u32;
    fn environ_sizes_get(count: *mut u32, buf_size: *mut u32) -> u32;
    fn environ_get(ptrs: *mut u32, buf: *mut u8) -> u32;
    fn proc_exit(code: u32) -> !;
}

const FD_STDIN: u32 = 0;
const FD_STDOUT: u32 = 1;
const FD_STDERR: u32 = 2;

// Calldata wire format: a header is ULEB128 of `(payload << 3) | type`.
const BITS_IN_TYPE: u32 = 3;
const TYPE_SPECIAL: u8 = 0;
const TYPE_STR: u8 = 4;
const TYPE_MAP: u8 = 6;
const SPECIAL_FALSE: u8 = (1 << BITS_IN_TYPE) | TYPE_SPECIAL;
const SPECIAL_TRUE: u8 = (2 << BITS_IN_TYPE) | TYPE_SPECIAL;

const MARKER: &[u8] = b"{\"probe\":\"tiny\",\"version\":\"1\"}\n";

// Statics live in .bss, so they cost no file bytes: wasm only stores non-zero
// data segments.
static mut INPUT: [u8; 65536] = [0; 65536];
static mut ENV_BUF: [u8; 2048] = [0; 2048];
static mut ENV_PTRS: [u32; 64] = [0; 64];
static mut OUT: [u8; 192] = [0; 192];
static mut OUT_LEN: usize = 0;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    unsafe { proc_exit(2) }
}

// wasi-libc's `crt1-command.o` is still linked (it provides `_start`), and it
// references three symbols that normally come from the rest of wasi-libc. This
// crate is `no_std`, so wasi-libc is absent and the linker would otherwise turn
// them into imports from a phantom `env` module, which would both break linking
// inside GenVM and make the import set differ from `verifier.wasm`. Defining
// them here keeps the imports to exactly the intended six.

/// Thread-pointer setup. There are no threads here, so there is nothing to do.
#[no_mangle]
pub extern "C" fn __wasi_init_tp() {}

/// C++ static destructors. There are none.
#[no_mangle]
pub extern "C" fn __wasm_call_dtors() {}

/// wasi-libc's exit shim; forward straight to the host call.
#[no_mangle]
pub extern "C" fn __wasi_proc_exit(code: u32) -> ! {
    unsafe { proc_exit(code) }
}

fn write_all(fd: u32, bytes: &[u8]) {
    let mut at = 0usize;
    while at < bytes.len() {
        let iov = Ciovec {
            buf: unsafe { bytes.as_ptr().add(at) },
            buf_len: (bytes.len() - at) as u32,
        };
        let mut written: u32 = 0;
        let rc = unsafe { fd_write(fd, &iov, 1, &mut written) };
        if rc != 0 || written == 0 {
            return;
        }
        at += written as usize;
    }
}

fn read_stdin(into: &mut [u8]) -> usize {
    let mut total = 0usize;
    while total < into.len() {
        let iov = Ciovec {
            buf: unsafe { into.as_ptr().add(total) },
            buf_len: (into.len() - total) as u32,
        };
        let mut got: u32 = 0;
        let rc = unsafe { fd_read(FD_STDIN, &iov, 1, &mut got) };
        if rc != 0 || got == 0 {
            break;
        }
        total += got as usize;
    }
    total
}

/// Mirrors what wasi-libc does at startup, and is the reason `environ_get` and
/// `environ_sizes_get` stay in the import list. The values are not used.
fn touch_environ() {
    let mut count: u32 = 0;
    let mut size: u32 = 0;
    let rc = unsafe { environ_sizes_get(&mut count, &mut size) };
    if rc != 0 {
        return;
    }
    unsafe {
        let ptrs = &mut *core::ptr::addr_of_mut!(ENV_PTRS);
        let buf = &mut *core::ptr::addr_of_mut!(ENV_BUF);
        if (count as usize) <= ptrs.len() && (size as usize) <= buf.len() {
            let _ = environ_get(ptrs.as_mut_ptr(), buf.as_mut_ptr());
        }
    }
}

fn push(byte: u8) {
    unsafe {
        let out = &mut *core::ptr::addr_of_mut!(OUT);
        if OUT_LEN < out.len() {
            out[OUT_LEN] = byte;
            OUT_LEN += 1;
        }
    }
}

fn push_bytes(bytes: &[u8]) {
    for &b in bytes {
        push(b);
    }
}

fn push_uleb(mut value: u64) {
    if value == 0 {
        push(0);
        return;
    }
    while value > 0 {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value > 0 {
            byte |= 0x80;
        }
        push(byte);
    }
}

fn push_header(payload: u64, typ: u8) {
    push_uleb((payload << BITS_IN_TYPE) | typ as u64);
}

fn push_str(value: &str) {
    push_header(value.len() as u64, TYPE_STR);
    push_bytes(value.as_bytes());
}

/// Map keys are raw: ULEB128(len) then the bytes, no type tag, sorted order.
fn push_key(key: &str) {
    push_uleb(key.len() as u64);
    push_bytes(key.as_bytes());
}

/// Scan, not parse: the ExtendedMessage is a map whose keys are raw
/// length-prefixed strings, so the key appears literally as 0x07 "is_init"
/// followed by its value byte.
fn find_is_init(input: &[u8]) -> Option<bool> {
    let needle = b"\x07is_init";
    let mut i = 0usize;
    while i + needle.len() < input.len() {
        if &input[i..i + needle.len()] == needle {
            return match input[i + needle.len()] {
                SPECIAL_TRUE => Some(true),
                SPECIAL_FALSE => Some(false),
                _ => None,
            };
        }
        i += 1;
    }
    None
}

/// The real entry point.
///
/// wasi-libc's `crt1-command.o` provides `_start`, which calls `__main_void`.
/// Defining `_start` here instead collides with that object, and rust-lld is
/// invoked directly so there is no `-nostartfiles` to drop it. Taking over
/// `__main_void` gets the same result: this is the first code of ours that
/// runs, the export list stays `memory` / `_start` / `__main_void` exactly as
/// in the std build and in `verifier.wasm`, and none of Rust's std startup is
/// linked because the crate is `no_std`.
#[no_mangle]
pub extern "C" fn __main_void() -> i32 {
    touch_environ();

    // Safety: single-threaded contract entry point, one exclusive borrow.
    let input = unsafe { &mut *core::ptr::addr_of_mut!(INPUT) };
    let read = read_stdin(input);
    let is_init = find_is_init(&input[..read]);

    // Marker line on stdout. gen_dbg_traceTransaction surfaces this verbatim.
    write_all(FD_STDOUT, MARKER);

    // {"Return": {"is_init": <bool|"unknown">, "probe": "tiny", "version": "1"}}
    push_header(1, TYPE_MAP);
    push_key("Return");
    push_header(3, TYPE_MAP);
    push_key("is_init");
    match is_init {
        Some(true) => push(SPECIAL_TRUE),
        Some(false) => push(SPECIAL_FALSE),
        None => push_str("unknown"),
    }
    push_key("probe");
    push_str("tiny");
    push_key("version");
    push_str("1");

    let mut result_fd: u32 = 0;
    let code = unsafe {
        let out = &*core::ptr::addr_of!(OUT);
        gl_call(out.as_ptr(), OUT_LEN as u32, &mut result_fd)
    };

    // A successful Return does not come back: the host tears the VM down. If
    // control reaches here the host refused the message, so say so on stderr
    // and fail loudly rather than exiting 0 and looking like a success.
    write_all(FD_STDERR, b"gl_call returned unexpectedly, code=");
    let mut digits = [0u8; 12];
    let mut n = code;
    let mut i = digits.len();
    loop {
        i -= 1;
        digits[i] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    write_all(FD_STDERR, &digits[i..]);
    write_all(FD_STDERR, b"\n");
    unsafe { proc_exit(1) }
}
