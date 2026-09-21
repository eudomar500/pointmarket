#!/usr/bin/env python3
"""
Prove that a deployed WASM contract actually executes inside GenVM on Bradbury.

The tls-verifier WASM exposes no named methods and no view method (see NOTES.md),
so there are two checks, cheapest first.

  trace  -- no key, no gas. Reads the deploy transaction's GenVM trace. The
            verifier's init path prints {"deployed":true,"version":"0.1.0"} to
            stdout and exits 0, so a non-empty stdout with that line is direct
            proof the module ran.

  call   -- needs PROBE_PK (genlayer-py requires a connected account to set the
            `from` field, even for a read). Sends a deliberately invalid 1-byte
            proof. NOTE: the contract does NOT return false for bad input; it
            errors out (see NOTES.md), so the expected outcome is a failure whose
            stderr reads "Failed to deserialize proof". That still proves the
            module ran, but it is a crash, not a clean false.

Usage:
    python3 read_bradbury.py trace <DEPLOY_TX_HASH>
    PROBE_PK=0x... python3 read_bradbury.py call <CONTRACT_ADDRESS>
"""

import json
import os
import sys
import urllib.request

RPC_URL = "https://rpc-bradbury.genlayer.com"


def rpc(method, params):
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    ).encode()
    req = urllib.request.Request(
        RPC_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            # The RPC edge answers 403 to urllib's default User-Agent.
            "User-Agent": "wasm-probe/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def do_trace(tx_hash):
    out = rpc("gen_dbg_traceTransaction", [{"txID": tx_hash, "round": 0}])
    if "error" in out and out["error"]:
        print(f"rpc error: {json.dumps(out['error'])}")
        sys.exit(1)
    result = out.get("result") or {}
    print(f"result_code : {result.get('result_code')}")
    print(f"run_time    : {result.get('run_time')}")
    print(f"stdout      : {result.get('stdout')!r}")
    print(f"stderr      : {result.get('stderr')!r}")
    rd = result.get("return_data") or ""
    print(f"return_data : {len(rd)} hex chars")

    decoded = None
    if rd.startswith("0x") and len(rd) > 2:
        try:
            from genlayer_py.abi import calldata

            decoded = calldata.decode(bytes.fromhex(rd[2:]))
        except Exception as exc:  # noqa: BLE001
            print(f"  (could not decode return_data: {exc})")

    if isinstance(decoded, dict):
        print(f"  kind      : {decoded.get('kind')}")
        print(f"  data      : {decoded.get('data')}")
        mods = (decoded.get("fingerprint") or {}).get("module_instances") or {}
        print(f"  modules   : {sorted(mods.keys())}")

    stdout = result.get("stdout") or ""
    data = decoded.get("data") if isinstance(decoded, dict) else None

    tiny_ok = (
        '"probe":"tiny"' in stdout
        and isinstance(data, dict)
        and data.get("probe") == "tiny"
    )
    verifier_ok = '"deployed":true' in stdout

    print()
    if tiny_ok:
        print("VERDICT: the raw WASM module loaded, ran, wrote to stdout and")
        print("         returned a value. Bradbury executes WASM contracts.")
    elif '"probe":"tiny"' in stdout:
        print("VERDICT: the module ran (stdout marker present) but the Return was")
        print("         not accepted. Check stderr for 'gl_call returned")
        print("         unexpectedly', which the probe prints in exactly that case.")
    elif verifier_ok:
        print("VERDICT: the WASM module executed inside GenVM on Bradbury.")
    else:
        print("VERDICT: inconclusive from stdout alone; inspect result_code and")
        print("         genvm_log above. result_code 2 with an 'invalid_contract'")
        print("         return_data means the module was rejected before it ran.")


def do_call(address):
    private_key = os.environ.get("PROBE_PK")
    if not private_key:
        print("error: PROBE_PK is not set", file=sys.stderr)
        sys.exit(1)

    from genlayer_py import create_account, create_client
    from genlayer_py.chains import testnet_bradbury

    account = create_account(private_key.strip())
    client = create_client(chain=testnet_bradbury, account=account)

    print(f"contract : {address}")
    print("sending a deliberately invalid 1-byte proof ...")
    try:
        result = client.read_contract(
            address=address,
            function_name="verify",
            args=[b"\x00"],
            raw_return=True,
        )
        print(f"returned : {result!r}")
        print("\nVERDICT: the contract returned without erroring (unexpected).")
    except Exception as exc:  # noqa: BLE001 - we want the raw message
        text = str(exc)
        print(f"raised   : {text[:800]}")
        if "deserialize" in text or "proof" in text.lower():
            print(
                "\nVERDICT: the error text came from the contract's own code, so "
                "the WASM module executed."
            )
        else:
            print(
                "\nVERDICT: inconclusive; the error may come from the node rather "
                "than the contract. Use the trace check."
            )


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("trace", "call"):
        print(__doc__)
        sys.exit(1)
    if sys.argv[1] == "trace":
        do_trace(sys.argv[2])
    else:
        do_call(sys.argv[2])


if __name__ == "__main__":
    main()
