#!/usr/bin/env python3
"""
Scan the GenLayer L2 chain for transactions whose gas limit exceeds 2^24.

Read-only. Sends nothing. Uses batched eth_getBlockByNumber(full=true) over the
public L2 RPC and reports, per sampled window of consecutive blocks, the number
of transactions seen, the highest transaction gas limit, and the block gasLimit
field.

Usage:
    python3 gas_cap_history_scan.py window <start> <count>
    python3 gas_cap_history_scan.py grid <lo> <hi> <points> <window>
"""

import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

URL = "https://rpc.testnet-chain.genlayer.com"
CAP = 1 << 24
BATCH = 40
WORKERS = 8


def rpc_batch(calls):
    body = json.dumps(
        [
            {"jsonrpc": "2.0", "id": i, "method": m, "params": p}
            for i, (m, p) in enumerate(calls)
        ]
    ).encode()
    req = urllib.request.Request(
        URL,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "wasm-probe/1.0"},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                out = json.loads(resp.read())
            return sorted(out, key=lambda r: r["id"])
        except Exception as exc:  # noqa: BLE001
            if attempt == 3:
                raise
            last = exc
    raise last


def fetch_blocks(numbers):
    chunks = [numbers[i : i + BATCH] for i in range(0, len(numbers), BATCH)]
    out = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for res in pool.map(
            lambda c: rpc_batch([("eth_getBlockByNumber", [hex(n), True]) for n in c]),
            chunks,
        ):
            out.extend(r.get("result") for r in res)
    return [b for b in out if b]


def summarize(blocks):
    ntx = 0
    over = []
    top = 0
    block_limits = set()
    ts_lo = ts_hi = None
    for b in blocks:
        block_limits.add(int(b["gasLimit"], 16))
        ts = int(b["timestamp"], 16)
        ts_lo = ts if ts_lo is None else min(ts_lo, ts)
        ts_hi = ts if ts_hi is None else max(ts_hi, ts)
        for t in b["transactions"]:
            g = int(t["gas"], 16)
            ntx += 1
            top = max(top, g)
            if g > CAP:
                over.append((int(b["number"], 16), ts, g, t["hash"]))
    return {
        "ntx": ntx,
        "max_tx_gas": top,
        "over": over,
        "block_gas_limits": sorted(block_limits),
        "ts_lo": ts_lo,
        "ts_hi": ts_hi,
    }


def do_window(start, count):
    blocks = fetch_blocks(list(range(start, start + count)))
    s = summarize(blocks)
    print(
        f"{start}..{start+count-1}  blocks={len(blocks)} ntx={s['ntx']} "
        f"max_tx_gas={s['max_tx_gas']} over2^24={len(s['over'])} "
        f"block_gas_limit={s['block_gas_limits']} ts={s['ts_lo']}..{s['ts_hi']}"
    )
    for row in s["over"][:20]:
        print(f"    OVER block={row[0]} ts={row[1]} gas={row[2]} tx={row[3]}")
    return s


def main():
    if sys.argv[1] == "window":
        do_window(int(sys.argv[2]), int(sys.argv[3]))
    elif sys.argv[1] == "grid":
        lo, hi, points, win = (int(x) for x in sys.argv[2:6])
        step = (hi - lo) // max(points - 1, 1)
        for i in range(points):
            do_window(lo + i * step, win)
            sys.stdout.flush()


if __name__ == "__main__":
    main()
