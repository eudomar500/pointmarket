#!/usr/bin/env python3
"""
Replay the exact addTransaction call that deploy_bradbury.py builds, through
eth_call instead of eth_estimateGas, and print the raw revert data.

Sends nothing. Needs no funds and no real key: eth_call is read-only and the
`from` address is arbitrary.

Usage:
    python3 diagnose_revert.py [path/to/contract.wasm]
"""

import json
import sys
import urllib.request
from pathlib import Path

from eth_account import Account
from genlayer_py import create_client
from genlayer_py.chains import testnet_bradbury
from genlayer_py.abi import calldata
from genlayer_py.abi.transactions import serialize
from genlayer_py.contracts.actions import _encode_add_transaction_data
from genlayer_py.contracts.utils import make_calldata_object
from web3.constants import ADDRESS_ZERO

RPC_URL = "https://rpc-bradbury.genlayer.com"
# The 210 KB verifier this was first run against lives in
# github.com/genlayerlabs/tls-twitter-bounty (tls-verifier-wasm/verifier.wasm)
# and is not vendored here. Pass its path as an argument to reproduce the
# original revert; the default is the tiny probe.
DEFAULT_WASM = Path(__file__).resolve().parent / "tiny-wasm" / "tiny_probe.wasm"
# Deterministic throwaway address; never funded, never signs anything here.
THROWAWAY_PK = "0x" + "11" * 32


def rpc(method, params):
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    ).encode()
    req = urllib.request.Request(
        RPC_URL,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "wasm-probe/1.0"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def build_deploy_calldata(client, account, code):
    """Exactly what genlayer_py.contracts.actions.deploy_contract builds."""
    data = [
        code,
        calldata.encode(make_calldata_object(method=None, args=[], kwargs=None)),
        False,  # leader_only
    ]
    serialized_data = serialize(data)
    return _encode_add_transaction_data(
        self=client,
        sender_account=account,
        recipient=ADDRESS_ZERO,
        consensus_max_rotations=client.chain.default_consensus_max_rotations,
        data=serialized_data,
    )


def decode_revert(raw):
    if not raw or raw in ("0x", "0x0"):
        return "empty revert data (no reason, no selector)"
    body = raw[2:] if raw.startswith("0x") else raw
    selector = "0x" + body[:8]

    if selector == "0x08c379a0":  # Error(string)
        from eth_abi import decode as abi_decode

        (reason,) = abi_decode(["string"], bytes.fromhex(body[8:]))
        return f"Error(string): {reason!r}"
    if selector == "0x4e487b71":  # Panic(uint256)
        from eth_abi import decode as abi_decode

        (code,) = abi_decode(["uint256"], bytes.fromhex(body[8:]))
        return f"Panic(uint256): 0x{code:02x}"

    # Try every custom error in the consensus ABIs shipped for chain 4221
    import eth_utils
    from genlayer_py.consensus.abi import (
        CONSENSUS_MAIN_ABI_V06,
        CONSENSUS_DATA_ABI_V06,
    )

    for abi in (CONSENSUS_MAIN_ABI_V06, CONSENSUS_DATA_ABI_V06):
        for entry in abi:
            if entry.get("type") != "error":
                continue
            sig = entry["name"] + "(" + ",".join(
                i["type"] for i in entry.get("inputs", [])
            ) + ")"
            if "0x" + eth_utils.keccak(text=sig)[:4].hex() == selector:
                return f"custom error {sig} (selector {selector})"
    return f"UNKNOWN selector {selector} (not in the shipped consensus ABIs)"


def main():
    wasm_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_WASM
    code = wasm_path.read_bytes()

    account = Account.from_key(THROWAWAY_PK)
    client = create_client(chain=testnet_bradbury, account=account)
    consensus = client.chain.consensus_main_contract["address"]

    encoded = build_deploy_calldata(client, account, code)

    print(f"payload      : {wasm_path.name} ({len(code)} bytes)")
    print(f"from         : {account.address}")
    print(f"to           : {consensus} (ConsensusMain)")
    print(f"calldata len : {len(encoded)} hex chars")
    print(f"value        : 0x0")

    for label, value in (("value=0", "0x0"),):
        print(f"\n--- eth_call with {label} ---")
        out = rpc(
            "eth_call",
            [{"from": account.address, "to": consensus, "data": encoded, "value": value},
             "latest"],
        )
        if "error" in out and out["error"]:
            err = out["error"]
            print(f"code    : {err.get('code')}")
            print(f"message : {err.get('message')}")
            raw = err.get("data")
            print(f"raw data: {raw!r}")
            if isinstance(raw, str):
                print(f"decoded : {decode_revert(raw)}")
        else:
            print(f"result  : {out.get('result')!r}  (no revert)")

    print("\n--- eth_estimateGas, for comparison ---")
    out = rpc(
        "eth_estimateGas",
        [{"from": account.address, "to": consensus, "data": encoded, "value": "0x0"}],
    )
    if "error" in out and out["error"]:
        err = out["error"]
        print(f"code    : {err.get('code')}")
        print(f"message : {err.get('message')}")
        print(f"raw data: {err.get('data')!r}")
        if isinstance(err.get("data"), str):
            print(f"decoded : {decode_revert(err['data'])}")
    else:
        print(f"gas     : {out.get('result')}")


if __name__ == "__main__":
    main()
