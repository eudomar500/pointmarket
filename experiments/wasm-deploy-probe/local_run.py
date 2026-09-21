#!/usr/bin/env python3
"""
Run the tiny WASM probe locally under wasmtime with a stubbed GenLayer host.

This checks, before anything is spent on chain, that the module:
  1. loads and runs to completion,
  2. writes the expected marker line to stdout,
  3. emits a well-formed {"Return": ...} calldata message through gl_call.

The host here is a stub, not GenVM. It proves the module and its calldata
encoding are correct; it does not prove Bradbury accepts WASM contracts, which
is what the on-chain deploy is for.

Usage:
    <venv>/bin/python local_run.py [path/to/tiny_probe.wasm]
"""

import sys
from pathlib import Path

from wasmtime import Engine, Func, Linker, Module, Store, WasiConfig

from genlayer_py.abi import calldata

# target/ is not vendored; the stripped artifact next to the crate is the one
# that was deployed. Pass a path to run a fresh build instead.
DEFAULT_WASM = Path(__file__).resolve().parent / "tiny-wasm" / "tiny_probe.wasm"

BITS_IN_TYPE = 3
TYPE_MAP = 6
TYPE_STR = 4
SPECIAL_TRUE = (2 << BITS_IN_TYPE) | 0


def uleb(value):
    out = bytearray()
    if value == 0:
        return b"\x00"
    while value > 0:
        b = value & 0x7F
        value >>= 7
        if value > 0:
            b |= 0x80
        out.append(b)
    return bytes(out)


def header(payload, typ):
    return uleb((payload << BITS_IN_TYPE) | typ)


def key(name):
    return uleb(len(name)) + name.encode()


def cd_str(value):
    return header(len(value), TYPE_STR) + value.encode()


def fake_extended_message(is_init=True):
    """A minimal ExtendedMessage, shaped like the one GenVM writes to stdin."""
    entry_data = header(0, TYPE_MAP)  # empty map: deploy with no constructor args
    parts = [
        header(2, TYPE_MAP),
        key("entry_data"),
        header(len(entry_data), 3) + entry_data,  # TYPE_BYTES
        key("is_init"),
        bytes([SPECIAL_TRUE if is_init else 8]),
    ]
    return b"".join(parts)


def main():
    wasm_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_WASM
    message = fake_extended_message(is_init=True)

    engine = Engine()
    module = Module.from_file(engine, str(wasm_path))
    store = Store(engine)

    stdin_file = Path("/tmp/tiny_probe_stdin.bin")
    stdout_file = Path("/tmp/tiny_probe_stdout.txt")
    stderr_file = Path("/tmp/tiny_probe_stderr.txt")
    stdin_file.write_bytes(message)
    stdout_file.write_bytes(b"")
    stderr_file.write_bytes(b"")

    wasi = WasiConfig()
    wasi.argv = ["tiny_probe"]
    wasi.env = []
    wasi.stdin_file = str(stdin_file)
    wasi.stdout_file = str(stdout_file)
    wasi.stderr_file = str(stderr_file)
    store.set_wasi(wasi)

    linker = Linker(engine)
    linker.define_wasi()

    captured = {}

    def gl_call_stub(ptr, length, _fd_out):
        mem = inst.exports(store)["memory"]
        data = bytes(mem.read(store, ptr, ptr + length))
        captured["message"] = data
        # A real Return tears the VM down; emulate that by trapping.
        raise Exception("RETURNED")

    for imp in module.imports:
        if imp.module == "genlayer_sdk":
            linker.define(store, "genlayer_sdk", imp.name, Func(store, imp.type, gl_call_stub))

    inst = linker.instantiate(store, module)
    start = inst.exports(store)["_start"]
    try:
        start(store)
        print("module exited without calling gl_call")
    except Exception as exc:
        if "RETURNED" not in str(exc):
            print(f"trap: {str(exc)[:200]}")

    out = stdout_file.read_bytes()
    err = stderr_file.read_bytes()
    print(f"stdout      : {out!r}")
    print(f"stderr      : {err!r}")

    raw = captured.get("message")
    if raw is None:
        print("FAIL: gl_call was never invoked")
        sys.exit(1)

    print(f"gl_call len : {len(raw)} bytes")
    print(f"gl_call hex : {raw.hex()}")
    decoded = calldata.decode(raw)
    print(f"decoded     : {decoded}")

    ok = (
        out.strip() == b'{"probe":"tiny","version":"1"}'
        and isinstance(decoded, dict)
        and "Return" in decoded
        and decoded["Return"].get("probe") == "tiny"
        and decoded["Return"].get("is_init") is True
    )
    print(f"\nVERDICT     : {'PASS' if ok else 'FAIL'}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
