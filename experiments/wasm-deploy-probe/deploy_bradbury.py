#!/usr/bin/env python3
"""
Deploy a raw WASM contract to GenLayer Testnet Bradbury (chain id 4221).

This is a minimal adaptation of deploy_wasm.py in
github.com/genlayerlabs/tls-twitter-bounty, which targets
a local Studio endpoint with an UNSIGNED gen_call and therefore cannot work on a
real network. Bradbury requires a signed EVM transaction to ConsensusMain, which
is what genlayer-py builds.

Usage:
    export PROBE_PK=0x<64 hex chars>
    python3 deploy_bradbury.py [path/to/contract.wasm]
    python3 deploy_bradbury.py [path/to/contract.wasm] --estimate-only
    python3 deploy_bradbury.py --source contracts/X.py [--arg V ...] [--dry-run]

--estimate-only builds the identical addTransaction calldata and stops at
eth_estimateGas. It sends nothing, needs no funds, and works with a throwaway
key, so it is the safe way to check a payload before spending.

--source <file> deploys a Python contract source instead of a wasm file. It is
run through strip_source.py first, the step docs/ESCROW.md and docs/ARBITER.md
use to produce the deployed form, and the stripped bytes are what is sent.

--arg <value> (repeatable) passes constructor arguments in order, each as a
string. With none, the constructor runs with its defaults.

--dry-run does everything a deploy does, including signing, and stops before
eth_sendRawTransaction.

The private key is read ONLY from the PROBE_PK environment variable. It is never
read from a file or an argument and is never printed.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

from genlayer_py import create_account, create_client
from genlayer_py.abi import calldata
from genlayer_py.abi.transactions import serialize
from genlayer_py.chains import testnet_bradbury
from genlayer_py.contracts.actions import _encode_add_transaction_data
from genlayer_py.contracts.utils import make_calldata_object
from genlayer_py.types import TransactionStatus
from web3.constants import ADDRESS_ZERO
from web3.logs import DISCARD

# The 210 KB verifier.wasm this probe started from lives in
# github.com/genlayerlabs/tls-twitter-bounty (tls-verifier-wasm/verifier.wasm)
# and is not vendored here: it is over both ceilings measured below and cannot
# be deployed. The default is the tiny probe that was deployed successfully.
DEFAULT_WASM = Path(__file__).resolve().parent / "tiny-wasm" / "tiny_probe.wasm"
STRIP_SOURCE = Path(__file__).resolve().parent / "strip_source.py"

# Bradbury has been observed to take 20-25 minutes to reach ACCEPTED, including
# leader rotations. genlayer-py defaults to 10 retries at 3s, which is 30s, so
# the defaults are overridden here.
POLL_INTERVAL_MS = 10_000
POLL_RETRIES = 240  # 40 minutes

# Measured on Bradbury 2026-09-21 by size_sweep.py: 52736 bytes of contract code
# estimate fine, 52992 bytes are refused with
# "invalid transaction: BlockPubdataLimitReached". The cap belongs to the zkSync
# Elastic Chain L2 underneath GenLayer, not to GenVM. See REVERT_ANALYSIS.md.
MAX_CODE_BYTES = 52_736

# Measured on Bradbury 2026-09-21 by gas_cap_search.py: a transaction signed
# with gas=16777216 (2^24) is accepted by eth_sendRawTransaction validation,
# gas=16777217 is refused with "gas limit too high" (code -32602). genlayer-py
# signs the raw eth_estimateGas result with no buffer (contracts/actions.py
# _prepare_transaction, transaction["gas"] = eth_estimateGas), so an estimate
# above this cap becomes a transaction the node will not even accept.
# Deploy gas is dominated by calldata, so in practice this binds before
# MAX_CODE_BYTES does: it is reached at roughly 20 kB of contract code.
MAX_TX_GAS = 16_777_216

# genlayer-py signs the raw estimate. That is too tight for this call. The first
# real attempt, L2 tx 0xd6255f35..., was signed at exactly the estimate,
# 2 222 870, consumed 2 122 093, never exhausted its own top-level limit, and
# still reverted: a nested frame five levels deep ran out of gas, because each
# CALL only forwards 63/64 of what is left. A ~4.7% margin does not survive that
# nesting. Gas is charged on what is used, not on the limit, so a generous limit
# costs nothing when the transaction succeeds.
GAS_MULTIPLIER = 3


def die(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def rpc(method, params):
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    ).encode()
    req = urllib.request.Request(
        testnet_bradbury.rpc_urls["default"]["http"][0],
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "wasm-probe/1.0"},
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read())


def signed_gas_limit(estimated_gas: int) -> int:
    """The limit the deploy is signed with: 3x the estimate, clamped to 2^24."""
    gas = min(estimated_gas * GAS_MULTIPLIER, MAX_TX_GAS)
    if gas < estimated_gas:
        die(f"estimate {estimated_gas:,} already exceeds the cap {MAX_TX_GAS:,}")
    return gas


def stripped_source(path: Path) -> bytes:
    """Run strip_source.py on path and return the bytes it writes.

    This is the same command the docs run to produce the deployed form, so the
    bytes signed here are the bytes the tests ran against.
    """
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / f"{path.stem}.deploy.py"
        done = subprocess.run(
            [sys.executable, str(STRIP_SOURCE), str(path), str(out)],
            capture_output=True,
            text=True,
        )
        if done.returncode != 0 or not out.is_file():
            die(f"strip_source.py failed on {path}:\n{done.stdout}{done.stderr}")
        return out.read_bytes()


def estimate_only(client, account, code, args=(), final: bool = True) -> int:
    """Build exactly what deploy_contract builds, then stop at estimation."""
    encoded = build_deploy_calldata(client, account, code, args)
    consensus = client.chain.consensus_main_contract["address"]
    print(f"to           : {consensus} (ConsensusMain)")
    print(f"calldata     : {len(encoded)} hex chars")
    out = rpc(
        "eth_estimateGas",
        [{"from": account.address, "to": consensus, "data": encoded, "value": "0x0"}],
    )
    if out.get("error"):
        err = out["error"]
        print(f"\nESTIMATE FAILED: code={err.get('code')} {err.get('message')}")
        print(f"raw data     : {err.get('data')!r}")
        sys.exit(1)
    gas_hex = out["result"]
    gas = int(gas_hex, 16)
    pct = 100.0 * gas / MAX_TX_GAS
    print(f"\nESTIMATED GAS: {gas_hex} ({gas:,})")
    print(f"per-tx cap   : {MAX_TX_GAS:,} (2^24), this uses {pct:.1f}%")
    if gas > MAX_TX_GAS:
        print(
            "\nOVER THE CAP: eth_sendRawTransaction would refuse this with "
            "'gas limit too high'.\nShrink the contract; deploy gas is "
            "dominated by calldata size."
        )
    if final:
        if gas <= MAX_TX_GAS:
            print(f"gas limit    : {signed_gas_limit(gas):,} would be signed "
                  f"({GAS_MULTIPLIER}x estimate, clamped to 2^24)")
        print("nothing was sent")
    return gas


def build_deploy_calldata(client, account, code, args=()):
    """Exactly what genlayer_py.contracts.actions.deploy_contract builds."""
    data = [
        code,
        calldata.encode(
            make_calldata_object(method=None, args=list(args), kwargs=None)
        ),
        False,  # leader_only
    ]
    return _encode_add_transaction_data(
        self=client,
        sender_account=account,
        recipient=ADDRESS_ZERO,
        consensus_max_rotations=client.chain.default_consensus_max_rotations,
        data=serialize(data),
    )


def send_deploy(
    client, account, code, estimated_gas: int, args=(), dry_run: bool = False
):
    """Sign and broadcast the deploy, printing the L2 hash before waiting.

    genlayer-py's deploy_contract signs, sends and waits inside one call and
    prints nothing, so when the L2 receipt comes back with status 0 it raises
    "Transaction failed" with no hash to investigate. This does the same work
    but announces the hash first, and signs with headroom over the estimate.
    """
    encoded = build_deploy_calldata(client, account, code, args)
    consensus = client.chain.consensus_main_contract["address"]

    gas = signed_gas_limit(estimated_gas)

    latest = client.w3.eth.get_block("latest")
    priority = client.w3.to_wei(2, "gwei")
    transaction = {
        "from": account.address,
        "nonce": client.w3.eth.get_transaction_count(account.address),
        "data": encoded,
        "to": consensus,
        "value": 0,
        "maxFeePerGas": latest["baseFeePerGas"] + priority,
        "maxPriorityFeePerGas": priority,
        "chainId": client.chain.id,
        "gas": gas,
    }
    signed = account.sign_transaction(transaction)
    raw = client.w3.to_hex(signed.raw_transaction)
    l2_hash = client.w3.to_hex(signed.hash)

    print(f"gas limit    : {gas:,} ({GAS_MULTIPLIER}x estimate, "
          f"{100.0 * gas / MAX_TX_GAS:.1f}% of cap)")
    print(f"nonce        : {transaction['nonce']}")
    print(f"L2 TX HASH   : {l2_hash}")
    print(f"L2 explorer  : https://zksync-os-testnet-genlayer.explorer.zksync.dev"
          f"/tx/{l2_hash}")
    if dry_run:
        print("\nDRY RUN: signed, not broadcast. nothing was sent")
        return None
    print("broadcasting ...")

    out = rpc("eth_sendRawTransaction", [raw])
    if out.get("error"):
        die(f"broadcast refused: {out['error'].get('message')}")
    sent = out["result"]
    if sent.lower() != l2_hash.lower():
        print(f"note         : node returned a different hash: {sent}")

    print("waiting for the L2 receipt ...")
    receipt = client.w3.eth.wait_for_transaction_receipt(sent, timeout=300)
    used = receipt["gasUsed"]
    price = receipt.get("effectiveGasPrice", 0)
    print(f"L2 status    : {receipt['status']} "
          f"({'success' if receipt['status'] == 1 else 'REVERTED'})")
    print(f"L2 gasUsed   : {used:,} of {gas:,}")
    print(f"L2 cost      : {used * price:,} wei")

    if receipt["status"] != 1:
        print(f"\nThe L2 transaction reverted. Inspect it with:")
        print(f"  python3 find_l2_tx.py {account.address}")
        print("and trace it for the failing frame. Nothing reached consensus.")
        sys.exit(1)

    contract = client.w3.eth.contract(
        abi=client.chain.consensus_main_contract["abi"]
    )
    events = contract.get_event_by_name("NewTransaction").process_receipt(
        receipt, DISCARD
    )
    if not events:
        die("L2 succeeded but no NewTransaction event was emitted")
    consensus_id = client.w3.to_hex(events[0]["args"]["txId"])
    print(f"\nCONSENSUS TX : {consensus_id}")
    print(f"explorer     : https://explorer-bradbury.genlayer.com/tx/{consensus_id}")
    return consensus_id


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("wasm", nargs="?", type=Path)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--arg", action="append", default=[], dest="args")
    parser.add_argument("--estimate-only", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    opts = parser.parse_args()
    estimate = opts.estimate_only
    ctor_args = opts.args

    private_key = os.environ.get("PROBE_PK")
    if not private_key:
        die("PROBE_PK is not set. export PROBE_PK=0x<64 hex chars>")
    private_key = private_key.strip()
    if not private_key.startswith("0x") or len(private_key) != 66:
        die("PROBE_PK must be a 0x-prefixed 32-byte hex string")

    if opts.source and opts.wasm:
        die("give either a wasm file or --source, not both")

    if opts.source:
        wasm_path = opts.source
        if not wasm_path.is_file():
            die(f"source file not found: {wasm_path}")
        source_size = wasm_path.stat().st_size
        wasm_bytes = stripped_source(wasm_path)
    else:
        wasm_path = opts.wasm or DEFAULT_WASM
        if not wasm_path.is_file():
            die(f"wasm file not found: {wasm_path}")

        wasm_bytes = wasm_path.read_bytes()
        if wasm_bytes[:4] != b"\x00asm":
            die(f"{wasm_path} does not start with the wasm magic bytes")

    if len(wasm_bytes) > MAX_CODE_BYTES:
        die(
            f"{wasm_path.name} is {len(wasm_bytes)} bytes; Bradbury refuses "
            f"contract code above about {MAX_CODE_BYTES} bytes with "
            f"'BlockPubdataLimitReached' (an L2 limit, not a GenVM one). "
            f"This deploy would revert at estimation. Run "
            f"'python3 size_sweep.py' to re-measure the ceiling, and see "
            f"REVERT_ANALYSIS.md."
        )

    account = create_account(private_key)
    if opts.source:
        print(f"source file  : {wasm_path} ({source_size} bytes)")
        print(f"stripped size: {len(wasm_bytes)} bytes (strip_source.py)")
    else:
        print(f"wasm file    : {wasm_path}")
        print(f"wasm size    : {len(wasm_bytes)} bytes")
    print(f"sha256       : {hashlib.sha256(wasm_bytes).hexdigest()}")
    print(f"ctor args    : {ctor_args if ctor_args else '(none, defaults)'}")
    print(f"deployer     : {account.address}")
    print(f"rpc          : {testnet_bradbury.rpc_urls['default']['http'][0]}")
    print(f"chain id     : {testnet_bradbury.id}")

    client = create_client(chain=testnet_bradbury, account=account)

    if estimate:
        estimate_only(client, account, wasm_bytes, ctor_args)
        return

    # Check the gas cap before anything is signed. genlayer-py signs the raw
    # estimate, so an over-cap estimate is a transaction the node rejects.
    gas = estimate_only(client, account, wasm_bytes, ctor_args, final=False)
    if gas > MAX_TX_GAS:
        die(
            f"estimated gas {gas:,} exceeds the per-transaction cap "
            f"{MAX_TX_GAS:,} (2^24); eth_sendRawTransaction would refuse this "
            f"with 'gas limit too high'. Shrink the contract."
        )
    print()

    balance = client.w3.eth.get_balance(account.address)
    print(f"balance      : {balance} wei")
    if balance == 0:
        message = (
            "deployer has zero balance; fund it at "
            "https://testnet-faucet.genlayer.foundation before deploying"
        )
        if not opts.dry_run:
            die(message)
        print(f"note         : {message}")

    print("\nsubmitting deploy transaction ...")
    tx_hash = send_deploy(
        client, account, wasm_bytes, gas, ctor_args, dry_run=opts.dry_run
    )
    if opts.dry_run:
        return

    print(
        f"\nwaiting for ACCEPTED (up to "
        f"{POLL_RETRIES * POLL_INTERVAL_MS // 60000} minutes) ..."
    )
    receipt = client.wait_for_transaction_receipt(
        transaction_hash=tx_hash,
        status=TransactionStatus.ACCEPTED,
        interval=POLL_INTERVAL_MS,
        retries=POLL_RETRIES,
    )

    decoded = receipt.get("tx_data_decoded") or {}
    address = decoded.get("contract_address") or receipt.get("recipient")

    print(f"\nstatus       : {receipt.get('status_name')}")
    print(f"execution    : {receipt.get('tx_execution_result_name')}")
    print(f"result       : {receipt.get('result_name')}")
    print(f"CONTRACT     : {address}")

    if address:
        print(f"\ncontract explorer: https://explorer-bradbury.genlayer.com/contract/{address}")
        print("\nnext:")
        print(f"  python3 read_bradbury.py {address}")


if __name__ == "__main__":
    main()
