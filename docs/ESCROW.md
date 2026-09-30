# Escrow v1.5

The deterministic half of v1.5: trades, windows, all money, CIDs, dispute
statements and bonds, and the Lacre delivery proof. The design is
`docs/V15_ARCHITECTURE.md`, sections 2.1, 2.2 and 3; this page is the
interface and the build steps.

## Files

| file | what |
|---|---|
| `contracts/Escrow.py` | production constants, the source of truth |
| `contracts/EscrowDemo.py` | generated, never edited: `python3 scripts/make_escrow_demo.py` |
| `tests/test_escrow.py` | direct-mode tests, `ESCROW_SOURCE=<file>` selects the source |

`scripts/make_escrow_demo.py --check` exits 1 when the demo file is stale.
The diff between the two files is the version number and the eight window
constants, and nothing else.

## Deploy the stripped output

The commented file is over the gas cap on its own. What is deployed, and
tested before deploying, is the output of `strip_source.py`:

```bash
python3 experiments/wasm-deploy-probe/strip_source.py contracts/Escrow.py /tmp/Escrow.deploy.py
ESCROW_SOURCE=/tmp/Escrow.deploy.py python3 -m pytest tests/test_escrow.py
python3 experiments/wasm-deploy-probe/estimate_source.py /tmp/Escrow.deploy.py
```

The constructor takes one argument, the Lacre Router address, which defaults
to `0xEf37cb72C3A9dD6bCE2f3575B75c94C555F9c8d9` so that `deploy_bradbury.py`,
which sends no constructor arguments, deploys it as is. After deploy:
`set_arbiter(<Arbiter>)`, once.

## Writes

Amounts are wei. "unpaused" marks the writes a pause blocks; the exits
(confirm, claims, response, proof, unboxing, settle, refunds) stay open so a
pause cannot trap money.

| method | caller | state | notes |
|---|---|---|---|
| `create_listing(title, description, price, listing_media_cid)` | anyone | - | unpaused; returns the trade id; CID optional |
| `cancel_listing(trade_id)` | seller | 0 -> 5 | unpaused |
| `accept_listing(trade_id)`, payable | anyone but seller | 0 -> 1 | unpaused; value equal to price |
| `mark_shipped(trade_id, tracking_number, tracking_carrier, carrier_domains, packing_media_cid)` | seller | 1 -> 2 | unpaused; up to 3 comma-separated domains from the carrier list, or empty; CID optional |
| `confirm_delivery(trade_id)` | buyer | 2 -> 4 | pays the seller price minus fee |
| `claim_after_window(trade_id)` | seller | 2 -> 4 | from `claim_at` |
| `claim_unshipped_refund(trade_id)` | buyer | 1 -> 6 | from `paid_at + MAX_SHIPPING_DELAY` |
| `set_unboxing_media(trade_id, cid)` | buyer | 3, or 4 never disputed | within `UNBOXING_WINDOW` of `disputed_at` or `delivered_at`; set once |
| `open_dispute(trade_id, claim_kind, statement, cid)`, payable | buyer | 2 -> 3 | unpaused; before `claim_at`; value `BUYER_BOND`; kind 1, 2 or 3; statement 1 to 2,000 chars; CID optional, becomes the unboxing CID |
| `respond_to_dispute(trade_id, statement, cid)`, payable | seller | 3 | once, before `disputed_at + DISPUTE_RESPONSE_WINDOW`; value `price * 500 / 10000` |
| `settle(trade_id, buyer_wins, reasoning_hash)` | arbiter | 3 -> 4 | winner takes price and both bonds; seller side net of fee; hash is 64 chars |
| `claim_dispute_default(trade_id)` | buyer | 3 -> 4 | no response and window over; refused when R1 or R2/R3 hold; 5% of the buyer bond kept as fee |
| `force_refund_stuck_dispute(trade_id)` | admin | 3 -> 6 | from `disputed_at + ADMIN_FORCE_REFUND_DELAY`; 50/50 plus own bonds |
| `claim_stuck_dispute_refund(trade_id)` | anyone | 3 -> 6 | from `disputed_at + PUBLIC_FORCE_REFUND_DELAY`; same split |
| `submit_delivery_proof(trade_id, record_id)` | seller | 2 or 3 | once; see below |
| `set_arbiter(address)` | admin | - | one-shot |
| `pause()`, `unpause()` | admin | - | |
| `transfer_admin(address)`, `accept_admin()`, `cancel_pending_admin()` | admin, pending admin | - | two-step |
| `propose_upgrade(code)`, `execute_upgrade()`, `cancel_pending_upgrade()` | admin | - | `UPGRADE_TIMELOCK` |
| `withdraw_fees(recipient, amount)` | admin | - | up to `fees_collected` |

`claim_at` is `shipped_at + DISPUTE_WINDOW`, or `proof_at + PROOF_CLAIM_DELAY`
when a proof is accepted and that is earlier. It is both the seller's first
claim and the buyer's last dispute.

Every payout is an external message to the wallet and settles when the
paying transaction is FINALIZED, not when it is ACCEPTED.

**Delivery proof.** The record is read from the Verifier the Router resolves,
at `LATEST_FINAL` only, and accepted when `check_for` holds for one of the
trade's carrier domains with `MIN_KEY_BITS = 1024` and any requester, its
`signed_at` is later than `paid_at`, and its `domain|selector|bh|signed_at`
has not served another trade. Anything else is `[EXPECTED] no accepted
attestation` and stores nothing.

## Views

| method | returns |
|---|---|
| `get_trade(trade_id)` | every `TradeData` field (addresses and wei as strings, times and kinds as ints), plus `trade_id`, `claim_at` (0 before shipping), `response_until` (`disputed_at + DISPUTE_RESPONSE_WINDOW`, 0 before a dispute), `unboxing_until` (`disputed_at + UNBOXING_WINDOW`, 0 before a dispute), `buyer_first_seen`, `seller_first_seen` |
| `get_eligible(start, count)` | `{"total": n, "ids": [...]}`, at most 1,000 ids: trades completed with the seller paid, in completion order |
| `get_contract_info()` | version, admin, pending admin, paused, arbiter, router, carrier domains, upgrade state, total trades, `fees_collected` |

Errors are `gl.vm.UserError("[EXPECTED] ...")`.
