#!/usr/bin/env python3
"""
Write contracts/EscrowDemo.py from contracts/Escrow.py by constant substitution.

The demo contract must differ from the production one in its timing constants
and version number and in nothing else (docs/V15_ARCHITECTURE.md, 2.1,
"Windows"), so it is never edited by hand: change Escrow.py, then run this.
Each constant line has to match exactly once, so a renamed or reformatted
constant stops the script instead of silently keeping a production value.

Usage:
    python3 scripts/make_escrow_demo.py           # write EscrowDemo.py
    python3 scripts/make_escrow_demo.py --check   # exit 1 if it is stale
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "contracts" / "Escrow.py"
DST = ROOT / "contracts" / "EscrowDemo.py"

SUBSTITUTIONS = [
    ("VERSION = u16(150)", "VERSION = u16(950)"),
    ("DISPUTE_WINDOW = 7 * 24 * 3600", "DISPUTE_WINDOW = 3600"),
    ("PROOF_CLAIM_DELAY = 72 * 3600", "PROOF_CLAIM_DELAY = 600"),
    ("UNBOXING_WINDOW = 72 * 3600", "UNBOXING_WINDOW = 24 * 3600"),
    ("DISPUTE_RESPONSE_WINDOW = 14 * 24 * 3600", "DISPUTE_RESPONSE_WINDOW = 3600"),
    ("MAX_SHIPPING_DELAY = 30 * 24 * 3600", "MAX_SHIPPING_DELAY = 3600"),
    ("ADMIN_FORCE_REFUND_DELAY = 30 * 24 * 3600", "ADMIN_FORCE_REFUND_DELAY = 7200"),
    ("PUBLIC_FORCE_REFUND_DELAY = 90 * 24 * 3600", "PUBLIC_FORCE_REFUND_DELAY = 10800"),
    ("UPGRADE_TIMELOCK = 48 * 3600", "UPGRADE_TIMELOCK = 300"),
]


def render(src: str) -> str:
    lines = src.split("\n")
    for old, new in SUBSTITUTIONS:
        hits = [i for i, line in enumerate(lines) if line == old]
        if len(hits) != 1:
            sys.exit(f"expected one line {old!r} in {SRC.name}, found {len(hits)}")
        lines[hits[0]] = new
    return "\n".join(lines)


def main() -> None:
    out = render(SRC.read_text())
    if "--check" in sys.argv[1:]:
        if not DST.exists() or DST.read_text() != out:
            sys.exit(f"{DST.name} is stale: run scripts/make_escrow_demo.py")
        print(f"{DST.name} matches {SRC.name}")
        return
    DST.write_text(out)
    print(f"{SRC.name} -> {DST.name}, {len(SUBSTITUTIONS)} constants")


if __name__ == "__main__":
    main()
