#!/usr/bin/env python3
"""
Locate an account's most recent L2 transaction, and print its receipt.

genlayer-py does not print the L2 hash before it waits, so a failure inside
_send_transaction leaves no hash to look up. Scanning thousands of blocks is
wasteful; instead this binary-searches the block at which the account's nonce
increments, which finds the transaction in about 20 RPC calls.

Read-only. Sends nothing.

Usage:
    python3 find_l2_tx.py <address> [nonce]

`nonce` is the nonce the wanted transaction used. Omitted, it defaults to the
current nonce minus one, which is the most recent transaction.
"""

import json
import sys
import urllib.request

L2 = "https://rpc.testnet-chain.genlayer.com"
GL = "https://rpc-bradbury.genlayer.com"


def rpc(url, method, params):
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    ).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "wasm-probe/1.0"},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read())


def nonce_at(address, block):
    out = rpc(L2, "eth_getTransactionCount", [address, hex(block)])
    if out.get("error"):
        raise RuntimeError(out["error"])
    return int(out["result"], 16)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    address = sys.argv[1]

    latest = int(rpc(L2, "eth_blockNumber", [])["result"], 16)
    current = nonce_at(address, latest)
    want = int(sys.argv[2]) if len(sys.argv) > 2 else current - 1

    print(f"address       : {address}")
    print(f"latest block  : {latest:,}")
    print(f"current nonce : {current}")
    print(f"looking for   : the transaction that used nonce {want}")

    # Smallest block where the nonce has already reached want+1.
    lo, hi = latest, latest
    step = 1
    while nonce_at(address, lo) > want and lo > 1:
        hi = lo
        step *= 2
        lo = max(1, latest - step)
    print(f"bracket       : blocks {lo:,} .. {hi:,}")

    while lo < hi:
        mid = (lo + hi) // 2
        if nonce_at(address, mid) > want:
            hi = mid
        else:
            lo = mid + 1
    block_no = lo
    print(f"nonce {want} landed in block {block_no:,}")

    block = rpc(L2, "eth_getBlockByNumber", [hex(block_no), True])["result"]
    target = None
    for tx in block["transactions"]:
        if tx["from"].lower() == address.lower() and int(tx["nonce"], 16) == want:
            target = tx
            break
    if target is None:
        print("could not find the transaction in that block")
        sys.exit(1)

    print(f"\nL2 HASH       : {target['hash']}")
    print(f"  to          : {target['to']}")
    print(f"  nonce       : {int(target['nonce'], 16)}")
    print(f"  gas limit   : {int(target['gas'], 16):,}")
    print(f"  input size  : {len(target['input']) // 2 - 1:,} bytes")
    print(f"  block       : {block_no:,}  ts {int(block['timestamp'], 16)}")

    receipt = rpc(L2, "eth_getTransactionReceipt", [target["hash"]])["result"]
    status = int(receipt["status"], 16)
    gas_used = int(receipt["gasUsed"], 16)
    price = int(receipt.get("effectiveGasPrice", "0x0"), 16)
    print(f"\n  status      : {status} ({'success' if status == 1 else 'REVERTED'})")
    print(f"  gasUsed     : {gas_used:,}")
    print(f"  gasPrice    : {price:,} wei")
    print(f"  cost        : {gas_used * price:,} wei")
    print(f"  logs        : {len(receipt.get('logs', []))}")

    # Replay through eth_call at that block to surface a revert reason.
    print("\n  replaying through eth_call at that block for a revert reason ...")
    out = rpc(
        L2,
        "eth_call",
        [
            {
                "from": target["from"],
                "to": target["to"],
                "data": target["input"],
                "value": target.get("value", "0x0"),
                "gas": target["gas"],
            },
            hex(block_no - 1),
        ],
    )
    if out.get("error"):
        err = out["error"]
        print(f"  eth_call    : code={err.get('code')} {err.get('message')}")
        print(f"  revert data : {err.get('data')!r}")
    else:
        print(f"  eth_call    : returned {out.get('result')!r} (no revert)")


if __name__ == "__main__":
    main()
