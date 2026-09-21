#!/usr/bin/env python3
"""Gas-limit distribution of L2 transactions in a block window. Read-only."""
import sys, time
from gas_cap_history_scan import fetch_blocks

start, count = int(sys.argv[1]), int(sys.argv[2])
t0 = time.time()
blocks = fetch_blocks(list(range(start, start + count)))
gas = sorted(int(t["gas"], 16) for b in blocks for t in b["transactions"])
n = len(gas)
def pct(p):
    return gas[min(n - 1, int(n * p))] if n else 0
buckets = [1 << 20, 4 << 20, 8 << 20, 12 << 20, 1 << 24, 20_000_000, 30_000_000]
print(f"blocks={len(blocks)} ntx={n} elapsed={time.time()-t0:.1f}s")
if n:
    print(f"  min={gas[0]} p50={pct(.5)} p90={pct(.9)} p99={pct(.99)} max={gas[-1]}")
    for b in buckets:
        print(f"  > {b:>10}: {sum(1 for g in gas if g > b):5d}")
