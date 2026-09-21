#!/usr/bin/env python3
"""
Bisect the L2 block range for the point after which no transaction carries a
gas limit above 2^24. Read-only; sends nothing.

Predicate for a window of W consecutive blocks: does it contain at least one
transaction with a gas limit above 2^24? Such transactions are rare -- order
one per ten thousand transactions before the cap -- so W has to be large enough
that a pre-cap window is very likely to contain one. Every window also reports
its transaction count and its count above 8M gas, as an activity control, so a
"no" caused by a quiet stretch is distinguishable from a "no" caused by the cap.

Usage: python3 gas_cap_bisect.py <lo_true> <hi_false> <window> <iters> <log>
"""
import datetime
import sys
import time

import gas_cap_history_scan as g

g.WORKERS = 24
g.BATCH = 50
CAP = 1 << 24


def probe(start, count, fh):
    t0 = time.time()
    blocks = g.fetch_blocks(list(range(start, start + count)))
    rows = [
        (int(b["number"], 16), int(b["timestamp"], 16), int(t["gas"], 16), t["hash"])
        for b in blocks
        for t in b["transactions"]
    ]
    over = sorted(r for r in rows if r[2] > CAP)
    big = [r for r in rows if r[2] > 8_000_000]
    ts = [int(b["timestamp"], 16) for b in blocks]
    day = (
        datetime.datetime.fromtimestamp(min(ts), datetime.timezone.utc).strftime(
            "%Y-%m-%d %H:%M"
        )
        if ts
        else "?"
    )
    mx = max((r[2] for r in rows), default=0)
    line = (
        f"{start}..{start+count-1} {day} blocks={len(blocks)} ntx={len(rows)} "
        f"over2^24={len(over)} over8M={len(big)} max={mx} [{time.time()-t0:.0f}s]"
    )
    for o in over:
        line += f"\n    OVER blk={o[0]} ts={o[1]} gas={o[2]} tx={o[3]}"
    print(line, flush=True)
    fh.write(line + "\n")
    fh.flush()
    return len(over) > 0, over, mx


def main():
    lo, hi = int(sys.argv[1]), int(sys.argv[2])
    win, iters, log = int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
    fh = open(log, "a")
    fh.write(f"# bisect lo={lo} hi={hi} window={win} iters={iters}\n")
    fh.flush()
    all_over = []
    for i in range(iters):
        if hi - lo <= win:
            break
        mid = (lo + hi) // 2
        hit, over, _ = probe(mid, win, fh)
        all_over.extend(over)
        if hit:
            lo = mid + win
        else:
            hi = mid
        fh.write(f"# after iter {i}: lo={lo} hi={hi}\n")
        fh.flush()
    fh.write(f"# bracket: last-true at or below {lo}, first-clean at or below {hi}\n")
    if all_over:
        last = max(all_over)
        fh.write(
            f"# latest over-cap tx seen: blk={last[0]} ts={last[1]} "
            f"gas={last[2]} tx={last[3]}\n"
        )
    fh.flush()


if __name__ == "__main__":
    main()
