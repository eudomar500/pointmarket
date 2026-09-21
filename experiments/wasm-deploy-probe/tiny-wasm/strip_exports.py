#!/usr/bin/env python3
"""
Remove named exports from a wasm module, leaving everything else byte-identical.

Why: the no_std probe has to define `__wasi_init_tp`, `__wasm_call_dtors` and
`__wasi_proc_exit` because wasi-libc is not linked (see tiny-wasm/src/main.rs).
Rust's `#[no_mangle]` also exports them, which the std build and `verifier.wasm`
do not do. The functions must stay in the module, because crt1 calls them; only
the export entries are dropped, so the export list matches the module this
experiment is being compared against.

Only the export section is rewritten. Function bodies, indices and every other
section are untouched.

Usage:
    python3 strip_exports.py <in.wasm> <out.wasm> <name> [<name> ...]
"""

import sys
from pathlib import Path

EXPORT_SECTION = 7


def read_uleb(data, i):
    result = 0
    shift = 0
    while True:
        byte = data[i]
        i += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, i
        shift += 7


def write_uleb(value):
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def rewrite_exports(data, drop):
    out = bytearray(data[:8])
    i = 8
    removed = []
    while i < len(data):
        section_id = data[i]
        i += 1
        size, i = read_uleb(data, i)
        body = data[i : i + size]
        i += size

        if section_id != EXPORT_SECTION:
            out.append(section_id)
            out += write_uleb(size)
            out += body
            continue

        count, j = read_uleb(body, 0)
        kept = bytearray()
        kept_count = 0
        for _ in range(count):
            start = j
            name_len, j = read_uleb(body, j)
            name = body[j : j + name_len].decode()
            j += name_len
            j += 1  # kind
            _, j = read_uleb(body, j)  # index
            if name in drop:
                removed.append(name)
                continue
            kept += body[start:j]
            kept_count += 1

        new_body = write_uleb(kept_count) + bytes(kept)
        out.append(section_id)
        out += write_uleb(len(new_body))
        out += new_body

    return bytes(out), removed


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    src, dst, names = Path(sys.argv[1]), Path(sys.argv[2]), set(sys.argv[3:])
    data = src.read_bytes()
    if data[:4] != b"\x00asm":
        print("error: not a wasm module", file=sys.stderr)
        sys.exit(1)
    new, removed = rewrite_exports(data, names)
    dst.write_bytes(new)
    print(f"removed exports : {removed}")
    print(f"{src.name}: {len(data)} bytes -> {dst.name}: {len(new)} bytes")


if __name__ == "__main__":
    main()
