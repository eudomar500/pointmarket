#!/usr/bin/env python3
"""
Send one write transaction to a contract on GenLayer Testnet Bradbury.

Usage:
    export PROBE_PK=0x<64 hex chars>
    python3 scripts/write_bradbury.py <contract> <method> [--arg V ...]
        [--value WEI] [--dry-run]

--arg <value> (repeatable) passes the method arguments in order, typed the way
the genlayer CLI types them: an integer becomes an int (of any size), true and
false become a bool, 0x followed by 40 hex digits becomes an Address, and
anything else is sent as a string.

--value <wei> is sent as the transaction value, for payable methods.

--dry-run estimates and signs, then stops before eth_sendRawTransaction.

Gas is handled exactly as in experiments/wasm-deploy-probe/deploy_bradbury.py:
estimate, sign with 3x the estimate clamped to 2^24, print the L2 hash before
broadcasting, then wait for the L2 receipt and for ACCEPTED. The constants and
helpers are imported from that file, not copied.

The private key is read ONLY from the PROBE_PK environment variable. It is never
read from a file or an argument and is never printed.
"""

import argparse
import os
import re
import sys
from pathlib import Path

PROBE_DIR = Path(__file__).resolve().parent.parent / "experiments" / "wasm-deploy-probe"
sys.path.insert(0, str(PROBE_DIR))

from deploy_bradbury import (  # noqa: E402
    GAS_MULTIPLIER,
    MAX_TX_GAS,
    POLL_INTERVAL_MS,
    POLL_RETRIES,
    die,
    rpc,
    signed_gas_limit,
)
from genlayer_py import create_account, create_client  # noqa: E402
from genlayer_py.abi import calldata  # noqa: E402
from genlayer_py.abi.transactions import serialize  # noqa: E402
from genlayer_py.chains import testnet_bradbury  # noqa: E402
from genlayer_py.contracts.actions import _encode_add_transaction_data  # noqa: E402
from genlayer_py.contracts.utils import make_calldata_object  # noqa: E402
from genlayer_py.types import CalldataAddress, TransactionStatus  # noqa: E402
from web3.logs import DISCARD  # noqa: E402

INT_RE = re.compile(r"^-?\d+$")
ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


def parse_arg(text: str):
    """Type one --arg value the way the genlayer CLI does."""
    if INT_RE.match(text):
        return int(text)
    if text == "true":
        return True
    if text == "false":
        return False
    if ADDRESS_RE.match(text):
        return CalldataAddress(text)
    return text


def show_arg(value) -> str:
    if isinstance(value, CalldataAddress):
        return f"Address({value.as_hex})"
    return repr(value)


def build_write_calldata(client, account, contract, method, args):
    """Exactly what genlayer_py.contracts.actions.write_contract builds."""
    data = [
        calldata.encode(
            make_calldata_object(method=method, args=list(args), kwargs=None)
        ),
        False,  # leader_only
    ]
    return _encode_add_transaction_data(
        self=client,
        sender_account=account,
        recipient=contract,
        consensus_max_rotations=client.chain.default_consensus_max_rotations,
        data=serialize(data),
    )


def estimate(account, consensus, encoded, value) -> int:
    out = rpc(
        "eth_estimateGas",
        [{"from": account.address, "to": consensus, "data": encoded,
          "value": hex(value)}],
    )
    if out.get("error"):
        err = out["error"]
        print(f"\nESTIMATE FAILED: code={err.get('code')} {err.get('message')}")
        print(f"raw data     : {err.get('data')!r}")
        sys.exit(1)
    gas = int(out["result"], 16)
    print(f"ESTIMATED GAS: {out['result']} ({gas:,})")
    print(f"per-tx cap   : {MAX_TX_GAS:,} (2^24), this uses "
          f"{100.0 * gas / MAX_TX_GAS:.1f}%")
    if gas > MAX_TX_GAS:
        die(f"estimated gas {gas:,} exceeds the per-transaction cap "
            f"{MAX_TX_GAS:,} (2^24); eth_sendRawTransaction would refuse this "
            f"with 'gas limit too high'")
    return gas


def send_write(client, account, encoded, value, estimated_gas, dry_run):
    """Sign and broadcast, printing the L2 hash before waiting.

    Same flow as send_deploy in deploy_bradbury.py, with the write calldata and
    the transaction value in place of the deploy calldata and zero.
    """
    consensus = client.chain.consensus_main_contract["address"]
    gas = signed_gas_limit(estimated_gas)

    latest = client.w3.eth.get_block("latest")
    priority = client.w3.to_wei(2, "gwei")
    transaction = {
        "from": account.address,
        "nonce": client.w3.eth.get_transaction_count(account.address),
        "data": encoded,
        "to": consensus,
        "value": value,
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
        print("\nThe L2 transaction reverted. Inspect it with:")
        print(f"  python3 {PROBE_DIR / 'find_l2_tx.py'} {account.address}")
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
    parser.add_argument("contract")
    parser.add_argument("method")
    parser.add_argument("--arg", action="append", default=[], dest="args")
    parser.add_argument("--value", type=int, default=0, help="value in wei")
    parser.add_argument("--dry-run", action="store_true")
    opts = parser.parse_args()

    if not ADDRESS_RE.match(opts.contract):
        die(f"contract must be 0x followed by 40 hex digits: {opts.contract}")
    if opts.value < 0:
        die("--value must not be negative")

    private_key = os.environ.get("PROBE_PK")
    if not private_key:
        die("PROBE_PK is not set. export PROBE_PK=0x<64 hex chars>")
    private_key = private_key.strip()
    if not private_key.startswith("0x") or len(private_key) != 66:
        die("PROBE_PK must be a 0x-prefixed 32-byte hex string")

    args = [parse_arg(a) for a in opts.args]
    account = create_account(private_key)
    client = create_client(chain=testnet_bradbury, account=account)
    contract = client.w3.to_checksum_address(opts.contract)
    consensus = client.chain.consensus_main_contract["address"]

    print(f"contract     : {contract}")
    print(f"method       : {opts.method}")
    print(f"args         : "
          f"{', '.join(show_arg(a) for a in args) if args else '(none)'}")
    print(f"value        : {opts.value} wei")
    print(f"sender       : {account.address}")
    print(f"rpc          : {testnet_bradbury.rpc_urls['default']['http'][0]}")
    print(f"chain id     : {testnet_bradbury.id}")
    print(f"to           : {consensus} (ConsensusMain)")

    encoded = build_write_calldata(client, account, contract, opts.method, args)
    print(f"calldata     : {len(encoded)} hex chars\n")

    balance = client.w3.eth.get_balance(account.address)
    print(f"balance      : {balance} wei")
    if balance <= opts.value:
        message = (
            f"sender balance {balance} wei does not cover the value "
            f"{opts.value} wei plus gas; fund it at "
            f"https://testnet-faucet.genlayer.foundation"
        )
        if not opts.dry_run:
            die(message)
        print(f"note         : {message}")
    print()

    gas = estimate(account, consensus, encoded, opts.value)

    print("\nsubmitting write transaction ...")
    tx_hash = send_write(client, account, encoded, opts.value, gas, opts.dry_run)
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

    print(f"\nstatus       : {receipt.get('status_name')}")
    print(f"execution    : {receipt.get('tx_execution_result_name')}")
    print(f"result       : {receipt.get('result_name')}")


if __name__ == "__main__":
    main()
