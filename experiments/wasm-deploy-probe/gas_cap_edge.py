#!/usr/bin/env python3
"""
Scan a contiguous block range and report every transaction whose gas limit
exceeds 2^24, plus the highest gas limit seen per chunk. Read-only.

Used to turn the bracket produced by gas_cap_bisect.py into an exact edge: the
last transaction above the cap, and the state of the chain after it.

Usage: python3 gas_cap_edge.py <start> <end> <log>
"""
import datetime
import sys
import time

import gas_cap_history_scan as g

g.WORKERS = 24
g.BATCH = 50
CAP = 1 << 24
CHUNK = 5000


def main():
    start, end, log = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    fh = open(log, "a")
    fh.write(f"# edge scan {start}..{end}\n")
    fh.flush()
    last = None
    for lo in range(start, end, CHUNK):
        hi = min(lo + CHUNK, end)
        t0 = time.time()
        blocks = g.fetch_blocks(list(range(lo, hi)))
        rows = [
            (int(b["number"], 16), int(b["timestamp"], 16), int(t["gas"], 16), t["hash"])
            for b in blocks
            for t in b["transactions"]
        ]
        over = sorted(r for r in rows if r[2] > CAP)
        at_cap = [r for r in rows if r[2] == CAP]
        mx = max((r[2] for r in rows), default=0)
        ts = [int(b["timestamp"], 16) for b in blocks]
        day = (
            datetime.datetime.fromtimestamp(min(ts), datetime.timezone.utc).strftime(
                "%Y-%m-%d %H:%M"
            )
            if ts
            else "?"
        )
        line = (
            f"{lo}..{hi-1} {day} ntx={len(rows)} over2^24={len(over)} "
            f"at2^24={len(at_cap)} max={mx} [{time.time()-t0:.0f}s]"
        )
        if over:
            last = over[-1]
            line += (
                f"\n    last in chunk: blk={last[0]} ts={last[1]} "
                f"gas={last[2]} tx={last[3]}"
            )
        print(line, flush=True)
        fh.write(line + "\n")
        fh.flush()
    if last:
        fh.write(
            f"# last over-cap tx in range: blk={last[0]} ts={last[1]} "
            f"gas={last[2]} tx={last[3]}\n"
        )
    fh.flush()


if __name__ == "__main__":
    main()
