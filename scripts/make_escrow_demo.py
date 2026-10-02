#!/usr/bin/env python3
"""
Write contracts/EscrowDemo.py from contracts/Escrow.py by constant substitution.

The demo contract must differ from the production one in its timing constants
and version number and in nothing else (docs/V15_ARCHITECTURE.md, 2.1,
"Windows"), so it is never edited by hand: change Escrow.py, then run this.
Each constant line has to match exactly once, so a renamed or reformatted
constant stops the script instead of silently keeping a production value.

--extra-carrier appends one domain to CARRIER_DOMAINS on top of the demo
substitutions, for test builds that need a sender no real carrier uses
(experiments/lacre-proof). Such a build is never EscrowDemo.py, so it needs
--out.

Usage:
    python3 scripts/make_escrow_demo.py           # write EscrowDemo.py
    python3 scripts/make_escrow_demo.py --check   # exit 1 if it is stale
    python3 scripts/make_escrow_demo.py --extra-carrier gmail.com \
        --out experiments/lacre-proof/EscrowProofDemo.py
"""

import argparse
import re
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

CARRIERS_LINE = re.compile(r'^CARRIER_DOMAINS = \(("[a-z0-9.-]+", )*"[a-z0-9.-]+"\)$')
DOMAIN = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$")


def render(src: str, extra_carrier: str | None = None) -> str:
    lines = src.split("\n")
    for old, new in SUBSTITUTIONS:
        hits = [i for i, line in enumerate(lines) if line == old]
        if len(hits) != 1:
            sys.exit(f"expected one line {old!r} in {SRC.name}, found {len(hits)}")
        lines[hits[0]] = new
    if extra_carrier is not None:
        hits = [i for i, line in enumerate(lines) if CARRIERS_LINE.match(line)]
        if len(hits) != 1:
            sys.exit(f"expected one CARRIER_DOMAINS tuple line in {SRC.name}, found {len(hits)}")
        if f'"{extra_carrier}"' in lines[hits[0]]:
            sys.exit(f"{extra_carrier} is already in CARRIER_DOMAINS")
        lines[hits[0]] = lines[hits[0]][:-1] + f', "{extra_carrier}")'
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the Escrow demo source.")
    parser.add_argument("--check", action="store_true", help="exit 1 if the output file is stale")
    parser.add_argument("--extra-carrier", metavar="DOMAIN", help="append DOMAIN to CARRIER_DOMAINS")
    parser.add_argument("--out", metavar="PATH", type=Path, help=f"output file (default {DST.relative_to(ROOT)})")
    opts = parser.parse_args()

    if opts.extra_carrier is not None:
        if not DOMAIN.match(opts.extra_carrier):
            sys.exit(f"not a lowercase domain: {opts.extra_carrier!r}")
        if opts.out is None:
            sys.exit("--extra-carrier needs --out: EscrowDemo.py keeps the production carrier list")
    dst = (opts.out or DST).resolve()

    out = render(SRC.read_text(), opts.extra_carrier)
    if opts.check:
        if not dst.exists() or dst.read_text() != out:
            sys.exit(f"{dst.name} is stale: run scripts/make_escrow_demo.py")
        print(f"{dst.name} matches {SRC.name}")
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(out)
    extra = f", carrier +{opts.extra_carrier}" if opts.extra_carrier else ""
    print(f"{SRC.name} -> {dst.name}, {len(SUBSTITUTIONS)} constants{extra}")


if __name__ == "__main__":
    main()
