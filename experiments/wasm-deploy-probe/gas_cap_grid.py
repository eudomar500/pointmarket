#!/usr/bin/env python3
"""
Sample windows of consecutive L2 blocks across a range and report, per window,
how many transactions carried a gas limit above 2^24. Read-only, sends nothing.

Usage: python3 gas_cap_grid.py <lo> <hi> <points> <window> [outfile]
"""
import sys, time, datetime
import gas_cap_history_scan as g

g.WORKERS = 16
g.BATCH = 50
CAP = 1 << 24


def scan(start, count):
    blocks = g.fetch_blocks(list(range(start, start + count)))
    gases = [(int(b["number"], 16), int(b["timestamp"], 16), int(t["gas"], 16), t["hash"])
             for b in blocks for t in b["transactions"]]
    over = [x for x in gases if x[2] > CAP]
    big = [x for x in gases if x[2] > 8_000_000]
    ts = [int(b["timestamp"], 16) for b in blocks]
    blim = sorted({int(b["gasLimit"], 16) for b in blocks})
    mx = max((x[2] for x in gases), default=0)
    day = datetime.datetime.utcfromtimestamp(min(ts)).strftime("%Y-%m-%d %H:%M") if ts else "?"
    line = (f"{start:>9}-{start+count-1:<9} {day} ntx={len(gases):<6} "
            f"over2^24={len(over):<4} over8M={len(big):<4} max={mx:<9} blockLimit={blim}")
    if over:
        line += "\n    last over: " + " ".join(f"blk={o[0]} gas={o[2]} tx={o[3]}" for o in over[-2:])
    return line, over, mx


def main():
    lo, hi, points, win = (int(x) for x in sys.argv[2:6]) if sys.argv[1] == "-" else (int(x) for x in sys.argv[1:5])
    out = sys.argv[5] if len(sys.argv) > 5 else None
    step = (hi - lo) // max(points - 1, 1)
    fh = open(out, "a") if out else None
    for i in range(points):
        s = lo + i * step
        t0 = time.time()
        line, over, mx = scan(s, win)
        line += f"  [{time.time()-t0:.0f}s]"
        print(line, flush=True)
        if fh:
            fh.write(line + "\n"); fh.flush()


if __name__ == "__main__":
    main()
