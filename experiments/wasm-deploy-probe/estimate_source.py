#!/usr/bin/env python3
"""
Estimate the Bradbury deploy gas for a contract source file, sending nothing.

Uses the same genlayer-py path deploy_bradbury.py uses (the same calldata
construction and the same addTransaction encoding) with a throwaway key, and
stops at eth_estimateGas.

Usage:
    python3 estimate_source.py <file> [<file> ...]
"""

import json
import sys
import urllib.request
from pathlib import Path

from eth_account import Account
from genlayer_py import create_client
from genlayer_py.abi import calldata
from genlayer_py.abi.transactions import serialize
from genlayer_py.chains import testnet_bradbury
from genlayer_py.contracts.actions import _encode_add_transaction_data
from genlayer_py.contracts.utils import make_calldata_object
from web3.constants import ADDRESS_ZERO

RPC_URL = "https://rpc-bradbury.genlayer.com"
MAX_TX_GAS = 16_777_216  # 2^24, measured by gas_cap_search.py


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
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    account = Account.create()
    client = create_client(chain=testnet_bradbury, account=account)
    consensus = client.chain.consensus_main_contract["address"]
    balance = client.w3.eth.get_balance(account.address)
    print(f"throwaway   : {account.address} (balance {balance} wei)")
    print(f"cap         : {MAX_TX_GAS:,} gas (2^24)\n")

    for path in sys.argv[1:]:
        code = Path(path).read_bytes()
        data = [
            code,
            calldata.encode(make_calldata_object(method=None, args=[], kwargs=None)),
            False,
        ]
        inner = serialize(data)
        encoded = _encode_add_transaction_data(
            self=client,
            sender_account=account,
            recipient=ADDRESS_ZERO,
            consensus_max_rotations=client.chain.default_consensus_max_rotations,
            data=inner,
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
        print(f"{Path(path).name}")
        print(f"  source bytes    : {len(code):,}")
        print(f"  txCallData bytes: {len(inner) // 2 - 1:,}  (RLP [code, calldata, leader_only])")
        print(f"  addTransaction  : {len(encoded) // 2 - 1:,} bytes")
        if out.get("error"):
            print(f"  ESTIMATE FAILED : {out['error'].get('message')}")
        else:
            gas = int(out["result"], 16)
            pct = 100.0 * gas / MAX_TX_GAS
            verdict = "OVER CAP" if gas > MAX_TX_GAS else "fits"
            print(f"  estimated gas   : {gas:,}  ({pct:.1f}% of cap)  {verdict}")
        print()


if __name__ == "__main__":
    main()
