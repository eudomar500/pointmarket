#!/usr/bin/env python3
"""
Find Bradbury's per-transaction gas limit cap, without spending anything.

Method: sign the real deploy transaction with a THROWAWAY key that holds zero
balance, and offer it to eth_sendRawTransaction at decreasing gas limits.
Validation happens before execution, so the node answers without charging, and
because the key has no balance the transaction can never be mined even if it
passed every other check. The script refuses to run if the key is not empty.

Above the cap the node answers "gas limit too high"; below it, the next check
that fails is the balance one. The transition is the cap.

Usage:
    python3 gas_cap_search.py [path/to/contract.wasm]
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
DEFAULT_WASM = Path(__file__).resolve().parent / "tiny_probe.wasm"


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


def classify(message: str) -> str:
    low = message.lower()
    if "gas limit is too high" in low or "gas limit too high" in low:
        return "TOO_HIGH"
    if "insufficient" in low or "not enough balance" in low or "balance" in low:
        return "BALANCE"   # gas limit accepted; stopped by the empty wallet
    if "gas" in low and ("low" in low or "intrinsic" in low):
        return "TOO_LOW"
    return "OTHER"


def main():
    wasm_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_WASM
    code = wasm_path.read_bytes()

    account = Account.create()  # fresh, never funded, never reused
    client = create_client(chain=testnet_bradbury, account=account)
    consensus = client.chain.consensus_main_contract["address"]

    balance = client.w3.eth.get_balance(account.address)
    print(f"throwaway address : {account.address}")
    print(f"balance           : {balance} wei")
    if balance != 0:
        print("error: refusing to run, the throwaway key is not empty", file=sys.stderr)
        sys.exit(1)
    print("nothing can be mined from an empty account, so this is safe\n")

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

    latest = client.w3.eth.get_block("latest")
    base_fee = latest["baseFeePerGas"]
    priority = client.w3.to_wei(2, "gwei")

    print(f"payload           : {wasm_path.name} ({len(code)} bytes)")
    print(f"block gasLimit    : {latest['gasLimit']:,}")

    def offer(gas):
        tx = {
            "from": account.address,
            "nonce": 0,
            "data": encoded,
            "to": consensus,
            "value": 0,
            "maxFeePerGas": base_fee + priority,
            "maxPriorityFeePerGas": priority,
            "chainId": testnet_bradbury.id,
            "gas": gas,
        }
        signed = account.sign_transaction(tx)
        out = rpc("eth_sendRawTransaction", [client.w3.to_hex(signed.raw_transaction)])
        if out.get("error"):
            msg = out["error"].get("message", "")
            return classify(msg), msg
        return "SENT", out.get("result")

    print("\ncoarse sweep")
    probes = [21_881_929, 20_000_000, 16_000_000, 12_000_000, 10_000_000, 8_000_000]
    for gas in probes:
        kind, msg = offer(gas)
        print(f"  gas={gas:>11,}  {kind:8} {msg[:90]}")
        if kind == "SENT":
            print("  UNEXPECTED: a transaction was accepted. Stopping.")
            sys.exit(1)

    print("\nbinary search for the highest accepted gas limit")
    lo, hi = 1, 21_881_929  # lo: accepted (not TOO_HIGH), hi: rejected as TOO_HIGH
    kind, _ = offer(lo)
    if kind == "TOO_HIGH":
        print("  even the smallest gas limit is refused as too high; aborting")
        sys.exit(1)
    while hi - lo > 1024:
        mid = (lo + hi) // 2
        kind, msg = offer(mid)
        print(f"  gas={mid:>11,}  {kind}")
        if kind == "TOO_HIGH":
            hi = mid
        else:
            lo = mid
    print(f"\nhighest gas limit not refused as too high: {lo:,}")
    print(f"lowest refused                            : {hi:,}")


if __name__ == "__main__":
    main()
