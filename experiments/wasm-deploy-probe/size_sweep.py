#!/usr/bin/env python3
"""
Find the largest contract payload Bradbury will accept, by driving the same
addTransaction call that deploy_bradbury.py builds to eth_estimateGas only.

Sends nothing, needs no funds, needs no real key.

Usage:
    python3 size_sweep.py            # coarse sweep, then binary search
"""

import json
import urllib.request

from eth_account import Account
from genlayer_py import create_client
from genlayer_py.chains import testnet_bradbury
from genlayer_py.abi import calldata
from genlayer_py.abi.transactions import serialize
from genlayer_py.contracts.actions import _encode_add_transaction_data
from genlayer_py.contracts.utils import make_calldata_object
from web3.constants import ADDRESS_ZERO

RPC_URL = "https://rpc-bradbury.genlayer.com"
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
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read())


def main():
    account = Account.from_key(THROWAWAY_PK)
    client = create_client(chain=testnet_bradbury, account=account)
    consensus = client.chain.consensus_main_contract["address"]

    def probe(n):
        code = b"\x61" * n
        data = [
            code,
            calldata.encode(make_calldata_object(method=None, args=[], kwargs=None)),
            False,
        ]
        encoded = _encode_add_transaction_data(
            self=client,
            sender_account=account,
            recipient=ADDRESS_ZERO,
            consensus_max_rotations=client.chain.default_consensus_max_rotations,
            data=serialize(data),
        )
        out = rpc(
            "eth_estimateGas",
            [
                {
                    "from": account.address,
                    "to": consensus,
                    "data": encoded,
                    "value": "0x0",
                }
            ],
        )
        if out.get("error"):
            return False, out["error"].get("message"), len(encoded)
        return True, out["result"], len(encoded)

    print("coarse sweep")
    for n in (1024, 8192, 32768, 49152, 65536, 98304, 131072, 210488):
        ok, info, clen = probe(n)
        verdict = f"OK gas={info}" if ok else str(info)
        print(f"  code={n:7}  calldata_hex={clen:7}  {verdict}")

    print("\nbinary search for the exact ceiling")
    lo, hi = 1024, 131072
    while hi - lo > 256:
        mid = (lo + hi) // 2
        ok, info, _ = probe(mid)
        print(f"  try {mid:7} -> {'OK' if ok else info}")
        if ok:
            lo = mid
        else:
            hi = mid
    print(f"\nlargest accepted: {lo} bytes of code; first refused: {hi} bytes")


if __name__ == "__main__":
    main()
