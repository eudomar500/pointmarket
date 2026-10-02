# v1.5 architecture

Date: 2026-09-30. Target: Testnet Bradbury, chain id 4221.

v1.4.7 is one 35,650-byte contract that holds the trades, the money and the
LLM arbitrator. It cannot be redeployed on Bradbury. v1.5 splits it along the
line between deterministic code and non-deterministic code, adds anchored
photo evidence that validators can actually read, and adds an optional
delivery proof read from Lacre. Everything below is decided by a measurement;
each one is cited where it is used.

--------------------------------------------------------------------------------
## 1. Constraints that decide the design

| constraint | measurement | consequence | source |
|---|---|---|---|
| Per-transaction gas cap of 2^24 = 16,777,216 | Binary search on `eth_sendRawTransaction`: 2^24 accepted, 2^24+1 refused with `gas limit too high`. Deploy gas is about 730 per source byte (18,000 bytes -> 15,247,074 gas fits; 20,000 bytes -> 16,803,816 over). | About 20 KB of source per contract, hard. `Marketplace.py` v1.4.7 at 35,650 bytes estimates at 28,902,212 gas (172.3% of the cap) and cannot be redeployed or replaced by redeploy. Stripping saves 93 bytes. Each v1.5 contract stays under 18 KB so that the deploy, signed at 3x the estimate and clamped to 2^24, keeps about 1.5 million gas over the estimate, about 1 million after the intrinsic calldata cost. | `docs/PRIMITIVES_STUDY.md` B.7, B.9; `experiments/wasm-deploy-probe/README.md` |
| `eth_estimateGas` understates | A deploy signed at the raw estimate reverted out of gas five frames deep; the same deploy at 3x succeeded, and gas is charged on use, not on the limit. | Every deploy goes through `deploy_bradbury.py` (3x, clamped to 2^24). Never through a path that signs the raw estimate (genlayer-py 0.16.3) or swallows the estimation revert (genlayer-js). | `experiments/wasm-deploy-probe/README.md`, "The two deploy transactions" |
| Calldata is public | `gen_getTransactionReceipt` on the public RPC, no auth, decodes a probe call's arguments in the clear, tracking number included. There is no encryption to validators, no private input, no private state. | Arguments are hashes, CIDs, record ids and short statements that the parties know are public. No address, name, order number or email ever goes into a call. | `docs/PRIMITIVES_STUDY.md` D.10 |
| The jury can see images | Measured 2026-09-30 on Bradbury, contract `0xa46A2c9804Ca2A41e06ACC7f5337F93A0973e3C4`: validators fetched a 61,111-byte PNG from `ipfs.filebase.io` and `gateway.pinit.io`, hashed it identically (sha256 matches the CID), and the model read it (`IPFS_LOGO`, validators agreed). `gateway.pinata.cloud` hangs until consensus times out (VALIDATORS_TIMEOUT, then LEADER_TIMEOUT, no record). | Filebase is the jury's gateway, pinit the fallback, pinata is never used for reads. Every fetch sends `Accept-Encoding: identity`. | `experiments/media-probe/README.md`, "Results" |
| No timers | No cron, no "execute at T", no trigger except a transaction. `emit(on='finalized')` is a one-hop "after this is final", not a clock. `on='accepted'` messages can be emitted again across appeal rounds. | Every deadline is enforced when somebody calls after it. Cross-contract writes are emitted `on='finalized'` only, and every receiver is idempotent. | `docs/PRIMITIVES_STUDY.md` C.9 |
| Carriers block validators | UPS and DHL answered HTTP 418, USPS 403 from Akamai, FedEx never produced a receipt. `raw_length` 0 in every case. | Tracking number and carrier stay seller-supplied strings, unchecked, as in v1.4.7. Delivery is evidenced by photos and, optionally, by a Lacre record of the carrier's signed email. | `experiments/tracking-probe/README.md`, "Findings" |

The PredictionMarket (32,761 bytes) hits the same wall and is not part of
v1.5. Its window views move to Reputation (2.4); `receive_fee` and the fee
sender wiring are dropped from the Escrow.

--------------------------------------------------------------------------------
## 2. Contracts

```
             seller / buyer                          anyone
                   |                                   |
                   v                                   v resolve(trade_id)
   +---------------------------------+      +---------------------------+
   | Escrow.py        (< 18 KB)      |      | Arbiter.py     (< 15 KB)  |
   | trades, state machine, windows, |<-----| no trade state; burden    |
   | all money, CIDs, delivery proof,|view, | rules and jury (nondet)   |
   | disputes: statements and bonds  |FINAL |                           |
   |                                 |      |                           |
   | settle: only from arbiter       |<=====| emit on='finalized'       |
   +----------------+----------------+      +---------------------------+
                    | view, LATEST_FINAL
                    v
   Lacre Router 0xEf37cb72C3A9dD6bCE2f3575B75c94C555F9c8d9
     -> resolve("verifier")

   Reputation.py (later): read-only views over the Escrow.
```

Deploy order: Escrow, then Arbiter with the Escrow address in its constructor,
then `Escrow.set_arbiter(arbiter)`, which is one-shot.

### 2.1 Escrow

Everything deterministic and all the money. Never runs a nondet block, so its
transactions are cheap to validate and never stall on a model or a gateway.

**Kept from v1.4.7 unchanged:** states 0 to 6 and their transitions; the fee
(200 bps); `create_listing`, `cancel_listing`, `accept_listing`,
`mark_shipped`, `confirm_delivery`, `claim_after_window`,
`claim_unshipped_refund`, `claim_dispute_default` (5% penalty on the initiator
bond), `force_refund_stuck_dispute`, `claim_stuck_dispute_refund` (50/50 plus
bonds); pause and unpause; two-step admin transfer; `propose_upgrade` /
`execute_upgrade` with the 48 h timelock; `withdraw_fees` and
`fees_collected` (read through `get_contract_info`); `first_seen` and
`eligible_trades`. `open_dispute` and `respond_to_dispute` stay on the Escrow
with new arguments (below), minus the model call.

**Dropped:** `_resolve_dispute_with_llm` and the prompt;
`llm_verdict_reasoning` as stored text (replaced by `verdict_hash`);
`receive_fee`, `withdraw_external_fees` and the fee sender methods; the four
window views (to Reputation); `get_metrics` and the trade counters
(`completed_count`, `disputed_count`, `refunded_count`, `total_volume`,
`received_external_fees`), none of which is on the Escrow.

**Added to `TradeData`:**

| field | type | set by | when |
|---|---|---|---|
| `listing_media_cid` | str | seller | `create_listing`, optional |
| `packing_media_cid` | str | seller | `mark_shipped`, optional |
| `unboxing_media_cid` | str | buyer | `open_dispute` or `set_unboxing_media`, within `UNBOXING_WINDOW` of `delivered_at` or `disputed_at` |
| `carrier_domains` | str | seller | `mark_shipped`: up to 3 comma-separated domains, each in `CARRIER_DOMAINS`, or empty |
| `delivery_proof` | str | seller | `submit_delivery_proof`: a Lacre Verifier record id, `""` by default |
| `proof_kind` | str | contract | `"dkim"` when a record was accepted, `""` otherwise; `"dkim+extract"` reserved |
| `proof_at` | u64 | contract | when the proof was accepted |
| `claim_kind` | u8 | buyer | `open_dispute`: 1 NOT_RECEIVED, 2 DAMAGED, 3 NOT_AS_DESCRIBED |
| `buyer_evidence` | str | buyer | `open_dispute`, 1 to 2,000 characters (kept from v1.4.7, shorter cap) |
| `seller_evidence` | str | seller | `respond_to_dispute`, 1 to 2,000 characters (kept from v1.4.7, shorter cap) |
| `seller_response_cid` | str | seller | `respond_to_dispute`, optional |
| `responded` | bool | contract | set by `respond_to_dispute`; blocks default judgment |
| `verdict_hash` | str | arbiter | sha256 hex of the reasoning, from `settle` |

**Contract state:** `arbiter_address: Address` (zero until `set_arbiter`,
then fixed), `router_address: Address` (constructor), `fees_collected: u256`,
`proof_messages: TreeMap[str, u256]` (replay guard, 2.2). The carrier domains
are not state: they are the module constant `CARRIER_DOMAINS = ("amazon.com",
"ups.com", "fedex.com", "dhl.com")`, a fixed tuple with no admin method to
change it, so a new domain means a redeploy. `get_contract_info` returns the
tuple as `carrier_domains`.

**CIDs.** Only raw CIDv1 with sha2-256 is accepted: 59 characters, prefix
`bafkrei`, base32 that decodes to `01 55 12 20` plus a 32-byte digest. The
format check is deterministic and runs on every setter. It matters because the
digest in such a CID is the sha256 of the file itself, so the jury can check
the bytes a gateway returns against the CID without trusting the gateway. The
frontend guarantees single-block files (section 4). A CID can be set once; a
setter refuses to overwrite.

**Shipping address.** Never in calldata. The parties exchange it off chain;
the frontend keeps a salted sha256 on each side so either can later show
which address was agreed. The salt is required: an address is low entropy and
an unsalted hash of it is a lookup.

**Disputes.** Both parties' writes are Escrow writes, so the state change and
the bond land in the same transaction and nothing can move the trade in
between:

- `open_dispute(trade_id, claim_kind, statement, cid)`, payable, buyer only.
  Requires `SHIPPED`, `now < claim_at` (2.2), `gl.message.value ==
  BUYER_BOND`, a known `claim_kind`, the statement length, and `cid` empty or
  a valid CID. Moves to `DISPUTED`, sets `disputed_at`, `claim_kind`,
  `buyer_evidence`, the buyer bond, and `unboxing_media_cid` if `cid` is set.
  Only the buyer opens a dispute in v1.5: in v1.4.7 a seller dispute only
  forced a verdict before the window closed, which `claim_after_window`
  already covers.
- `respond_to_dispute(trade_id, statement, cid)`, payable, seller only.
  Requires `DISPUTED`, not `responded`, `now < disputed_at +
  DISPUTE_RESPONSE_WINDOW`, value equal to the seller bond (`price *
  SELLER_BOND_BPS / 10000`). Sets `seller_evidence`, `seller_response_cid`,
  the seller bond and `responded`. Unlike v1.4.7 it does not resolve: the
  jury runs on the Arbiter.
- `settle(trade_id, buyer_wins, reasoning_hash)`, only from
  `arbiter_address`, only in `DISPUTED`. Pays out (section 3, bonds), stores
  `verdict_hash`, and refuses anything else, so a repeated or late message
  changes nothing.

`seller_response_cid` is shown in the frontend and cited in the prompt, but
it is not fetched and cannot satisfy a burden rule: evidence made after the
dispute opened is not anchored evidence.

**State machine**, v1.4.7's with the dispute leg rewired:

```
 LISTING_OPEN(0) --accept_listing--> PAID(1) --mark_shipped--> SHIPPED(2)
       |                               |                         |
  cancel_listing              claim_unshipped_refund             |
       v                               v                         |
  CANCELLED(5)                    REFUNDED(6)                    |
                                                                 |
       +-------------------+---------------------+---------------+
       |                   |                     |
 confirm_delivery   claim_after_window      open_dispute (buyer, bond,
       |            (after claim_at)         before claim_at)
       v                   v                     v
  COMPLETED(4)        COMPLETED(4)          DISPUTED(3)
                                                 |  respond_to_dispute
                                                 |  (seller, bond; state stays 3,
                                                 |   responded = true)
       +-------------------+---------------------+-------------------+
       |                   |                                         |
  settle (from Arbiter,   claim_dispute_default              force / public
  after resolve)          (no response within window,        stuck refund
       |                   burden rules applied)             (30 d / 90 d)
       v                   v                                         v
  COMPLETED(4)        COMPLETED(4)                              REFUNDED(6)
```

`submit_delivery_proof` and `set_unboxing_media` change fields, not states.

**Windows**, one constant block, demo values in `EscrowDemo.py` produced by
constant substitution only (the diff against `Escrow.py` must show constants
and nothing else, as with `MarketplaceDemo.py` today):

| constant | demo | production | meaning |
|---|---|---|---|
| `DISPUTE_WINDOW` | 1 h | 7 d | from `shipped_at`: seller may claim after, buyer may dispute before |
| `PROOF_CLAIM_DELAY` | 10 min | 72 h | from `proof_at`, see 2.2 |
| `UNBOXING_WINDOW` | 24 h | 72 h | from `delivered_at` or `disputed_at` |
| `DISPUTE_RESPONSE_WINDOW` | 1 h | 14 d | from `disputed_at` |
| `MAX_SHIPPING_DELAY` | 1 h | 30 d | from `paid_at` |
| `ADMIN_FORCE_REFUND_DELAY` | 2 h | 30 d | from `disputed_at` |
| `PUBLIC_FORCE_REFUND_DELAY` | 3 h | 90 d | from `disputed_at` |
| `UPGRADE_TIMELOCK` | 300 s | 48 h | |

**Size budget**, bytes of source as deployed:

| part | budget |
|---|---:|
| constants, `TradeData` (with the dispute fields) | 2,000 |
| helpers (`_now`, auth, recipient, CID check) | 800 |
| listing, accept, cancel, ship, confirm, claims | 4,100 |
| `set_unboxing_media` | 400 |
| `open_dispute`, `respond_to_dispute`, `settle`, default, stuck refunds | 3,500 |
| one `_pay` helper replacing the four payout functions | 1,300 |
| delivery proof: helper, `submit_delivery_proof`, carrier list | 1,800 |
| admin: pause, admin transfer, upgrade, withdraw, `set_arbiter` | 2,600 |
| views: `get_trade`, `get_contract_info`, eligible slice | 1,300 |
| **total** | **17,800** |

The gate is 18,000 bytes, about 15.25 million gas. The margin was 200 bytes,
and both levers named for it are in the deployed code: carrier domains as a
constant tuple instead of an admin-managed map (about 400 bytes), and no
`get_metrics` on the Escrow (about 300). Comments count: if the committed file
has them, deploy and test the output of `strip_source.py`, not the commented
file.

### 2.2 Delivery proof, inside the Escrow

Not a third contract: it is one helper and one write, and a third contract
would add a cross-contract hop to the one path that pays the seller.

**The helper** is `attested()` from `~/proyectos/lacre/integrations/consumer_example.py`
(the block between `integrate:begin` and `integrate:end`), copied as is: it
resolves `verifier` through the Router on every use, never caches an address,
reads only at `StorageType.LATEST_FINAL`, and never raises. On top of it the
Escrow's `require_attestation(record_id, domains)` adds the payment-date check
and the replay guard (`lacre/docs/direct-use.md`, rule 5). It does not read
the KeyCache: Verifier v1.2 attests only against a key the KeyCache holds as
`active`, so the record itself is the proof.

**The write.** `submit_delivery_proof(trade_id, record_id)`, seller only,
state `SHIPPED` or `DISPUTED` (before `settle`), `delivery_proof` empty. The
Escrow accepts the record only if all of these hold:

1. `check_for(record_id, domain, MIN_KEY_BITS, record.requester)` is true for
   some `domain` in the trade's `carrier_domains`: the record is `valid`,
   `aligned`, signed by that domain, with a key of at least
   `MIN_KEY_BITS = 1024`. Any requester is accepted: the requester proves who
   paid for the attestation, not who received the email, and the seller may
   have used the gateway.
2. `record.signed_at` (the DKIM `t=` tag, an integer, 0 when absent) is later
   than the trade's `paid_at`. An email signed before the buyer paid cannot be
   about this shipment.
3. `domain|selector|bh|signed_at` is not a key of `proof_messages`. On
   success it is stored there with the trade id, so one signed email serves
   one trade.

Then `delivery_proof = record_id`, `proof_kind = "dkim"`, `proof_at = now`.
Anything else raises `[EXPECTED] no accepted attestation` and stores nothing.

The floor is 1024 bits because the amazon.com key is 1024 bits today and a
higher floor refuses every record. It is a constant; raise it to 2048 once the
listed domains publish 2048-bit keys.

**Effect 1, the claim window.** Without a proof the seller claims at
`shipped_at + DISPUTE_WINDOW`, as in v1.4.7. With one:

    claim_at = min(shipped_at + DISPUTE_WINDOW, proof_at + PROOF_CLAIM_DELAY)

7 days becomes as little as 72 hours after the proof in production, 1 hour as
little as 10 minutes in demo. The buyer's dispute deadline is the same
`claim_at`, so the buyer's time to object shortens by the same amount. 72
hours matches `UNBOXING_WINDOW`: a buyer who received the parcel has the same
time to object that they have to anchor the unboxing photo.

**Effect 2, the dispute.** A buyer whose claim is NOT_RECEIVED against a trade
with an accepted proof loses by rule (section 3), without a jury.

**Without a proof nothing changes** from v1.4.7: same windows, same claims,
NOT_RECEIVED goes to the rules and the jury as any other claim.

**What this proves and what it does not.** Lacre attests that a mail server
holding the carrier domain's DKIM key signed a message with these headers at
`signed_at`. It does not attest that a parcel reached a door. What that
carries:

- It proves the carrier's system sent the seller a message after the buyer
  paid, and that the seller holds it. A forged or edited email fails the
  signature.
- It does not prove the message is about this parcel. v1.5 checks headers
  only; the tracking number is not bound to the signed content, because the
  Verifier does not read bodies and the Extractor lane is not required. That
  binding is what `"dkim+extract"` is reserved for: require
  `require_shipped` on the patterns lane and compare the extracted tracking
  number with the one given at `mark_shipped`.
- It does not prove the message says "delivered". A shipping confirmation
  from the same domain passes the same checks.
- It does not prove what was in the box. Condition is the photos' job.

So the proof is a strong signal that a real shipment through that carrier
happened after payment, strong enough to shorten a window and to defeat a bare
"never arrived", and not strong enough to decide condition. That is the
weight it is given.

### 2.3 Arbiter

Burden rules and the jury, nothing else. Target under 15 KB. Payable nowhere,
holds no funds and no trade state: everything it judges is read from the
Escrow.

**State:** `escrow_address` (constructor, fixed), `admin`, `pending_admin`,
`paused`. Nothing per trade. No upgrade path in v1.5: `set_arbiter` is
one-shot, so replacing the Arbiter means redeploying the Escrow, and nobody
can swap the judge quietly.

**`resolve(trade_id)`**, anyone. Reads `Escrow.get_trade(trade_id)` at
`LATEST_FINAL`, so the dispute it judges cannot be appealed away underneath
it; a `respond_to_dispute` counts once it is final. Requires `DISPUTED`. Runs
the burden rules of section 3 first; a rule that decides emits `settle` with
no fetch and no model. If the jury is needed and the seller has not
responded, it refuses: that case belongs to `claim_dispute_default` on the
Escrow after the response window. A second `resolve` before `settle` lands
repeats the work and its `settle` is refused by the Escrow; with no per-trade
state that is the price of the Arbiter holding nothing, and it costs only gas.

**Size budget:**

| part | budget |
|---|---:|
| constants, Escrow interface, admin and pause | 2,000 |
| CID digest decode, burden rules | 1,800 |
| jury: fetch with fallback, digest check, prompt, validator | 5,000 |
| `resolve`, `settle` emit | 800 |
| **total** | **9,600** |

The gate stays at 15,000 bytes; the slack is for prompt wording, which is the
part most likely to grow after the first real disputes.

**The jury**, one nondet block through `gl.vm.run_nondet_unsafe`:

1. Fetch the two relevant images (section 3 says which) from
   `https://ipfs.filebase.io/ipfs/<cid>`, falling back to
   `https://gateway.pinit.io/ipfs/<cid>`, with `Accept-Encoding: identity`.
   A body counts only on HTTP 200, at most 1,000,000 bytes, with sha256 equal
   to the CID's digest. If neither gateway yields matching bytes for an image,
   raise `[EXPECTED] media unavailable`: the transaction records nothing and
   `resolve` can be called again later.
2. Prompt, in this order: the listing (title, description, the listing image
   as the reference), then the evidence (which image is which, with its CID
   and when it was anchored), then the two statements, delimited and marked
   as data, never instructions. `exec_prompt(prompt, images=[a, b],
   response_format='json')`.
3. Output `{"verdict": "BUYER" | "SELLER", "reasoning": str}`, reasoning cut
   to 300 characters. Anything else raises.
4. Validator: re-run the same function and accept only if its `verdict`
   equals the leader's. Reasoning is not compared. A leader error is accepted
   only if the validator's own run also raises `UserError` (the v1.4.7
   pattern).

**Note, 2026-10-01: one image per resolve.** Steps 1 to 4 above are
superseded. On Bradbury, `resolve` with two images in one vision call timed
out (round 0 [T,T,A,T,A]; final round 6 TIMEOUT vs 5 AGREE; a retry hit
LEADER_TIMEOUT), while the media probe, one image per call, got 5 of 5 AGREE.
The jury now fetches one image (NOT_AS_DESCRIBED and DAMAGED: unboxing;
NOT_RECEIVED: packing; same gateways, cap and digest check) and asks for a
closed label against the listing title and description: MATCHES / DIFFERENT /
UNCLEAR, or INTACT / DAMAGED / UNCLEAR for DAMAGED. Only DIFFERENT (or
DAMAGED) wins for the buyer; the claimant carries the burden. The validator
compares the label and the digest result. Rules R1 to R6 are unchanged; a
digest failure blanks the image and R2, R3 or R6 decides. Interface and
prompt: `docs/ARBITER.md`.

Then `Escrow.settle(trade_id, buyer_wins, sha256(reasoning))` is emitted
`on='finalized'`. The reasoning text is the nondet block's result, readable
in the `resolve` receipt and checkable against `verdict_hash` on the Escrow;
neither contract stores it.

**Finalities.** One per bond: each bond is paid in the same Escrow write that
records the party's statement, and is final when that write is. Two per
dispute resolution: the verdict finalizes on the Arbiter, then the payout
finalizes on the Escrow, about 35 minutes each on Bradbury today. Accepted
because: money moves only on a verdict that can no longer be appealed, which
`on='accepted'` would not give; the Escrow never executes a model or a fetch,
so a jury that stalls cannot stall withdrawals, claims or other trades; and
an extra half hour on a path whose windows are measured in days costs nothing
a user will notice.

If the jury never agrees, `resolve` keeps reverting and the trade reaches the
stuck-dispute path: admin 50/50 after 30 days, anyone after 90, as today.

### 2.4 Reputation, later

Read-only views over the Escrow, deployed after v1.5 runs: the four window
views from v1.4.7 (count, volume, dispute rate, average price), bounded by
`MAX_ELIGIBLE_TRADES_LOOKBACK = 1000` with `truncated`, plus per address
completed, disputed and lost counts. It reads `get_trade` and the eligible
slice at `LATEST_FINAL`, holds no state and moves no money. Unboxing CIDs set
after `confirm_delivery` feed it; they change no payout.

--------------------------------------------------------------------------------
## 3. Evidence model

**Burden rules**, evaluated in `resolve` top to bottom, first match decides.
"Window closed" means `now >= disputed_at + UNBOXING_WINDOW`.

| # | claim | condition | outcome | jury images |
|---|---|---|---|---|
| R1 | NOT_RECEIVED | `proof_kind` is set | seller wins | none |
| R2 | DAMAGED or NOT_AS_DESCRIBED | `unboxing_media_cid` empty and window closed | seller wins | none |
| R3 | DAMAGED or NOT_AS_DESCRIBED | `unboxing_media_cid` empty and window open | refuse, wait | none |
| R4 | NOT_AS_DESCRIBED | `listing_media_cid` empty | buyer wins | none |
| R5 | DAMAGED | `packing_media_cid` empty | buyer wins | none |
| R6 | NOT_RECEIVED | `packing_media_cid` empty | buyer wins | none |
| J1 | NOT_AS_DESCRIBED | both complied | jury compares | listing, unboxing |
| J2 | DAMAGED | both complied | jury compares | packing, unboxing |
| J3 | NOT_RECEIVED, no proof | seller showed packing | jury | listing, packing |

In words: a buyer who alleges damage without an unboxing CID loses; a seller
without a listing or packing CID cannot claim good condition; when both
complied the jury compares the anchored images; a buyer who alleges
non-delivery against an accepted proof loses that point by rule. Without
consensus the dispute falls to the 50/50 stuck path, as today.

`claim_dispute_default` applies the same rules before paying the buyer by
default: a buyer who fails R1 or R2 cannot win by the seller's silence, and
anyone may call `resolve` to close it for the seller.

**Bonds.**

| party | bond | constant |
|---|---|---|
| buyer, on `open_dispute` | fixed, 10^16 wei (0.01 GEN) | `BUYER_BOND` |
| seller, on `respond_to_dispute` | 5% of price | `SELLER_BOND_BPS = 500` |

The seller holds the larger stake and the buyer's griefing is already priced
by the burden rules, so the buyer's bond is kept small enough not to deter an
honest claim. The loser forfeits their bond to the winner, whether a rule or
the jury decided. Default judgment keeps the v1.4.7 5% penalty on the
initiator bond. The stuck path returns both bonds. The fee is charged when the
seller is paid, as today.

**Privacy.** CIDs are public and so are the images behind them, pinned by the
service for as long as the pin lives; statements are public text. The upload
dialog says so before anything is pinned. The frontend re-encodes every image,
which strips EXIF and with it GPS position, and asks the user to keep labels,
addresses and faces out of frame.

--------------------------------------------------------------------------------
## 4. Frontend

**Pinning.** A Next.js route handler, `app/api/pin/route.ts`, receives the
image and pins it through Filebase with a key held server-side (an env var
without the `NEXT_PUBLIC_` prefix, never shipped to the browser). Before
upload the browser re-encodes to JPEG at most 240 KB, so the file is a single
raw block and its CID is `bafkrei...`. The handler computes that CID from the
bytes itself and refuses to return it if the service reports a different one.
The pin is the service's, so a party cannot unpin their own evidence to stall
the jury. Images are displayed from `https://ipfs.filebase.io/ipfs/<cid>`,
the same bytes the jury reads.

**New writes to wire:**

| contract | method | page |
|---|---|---|
| Escrow | `create_listing(title, description, price, listing_media_cid)` | new listing |
| Escrow | `mark_shipped(trade_id, tracking_number, tracking_carrier, carrier_domains, packing_media_cid)` | trade, seller |
| Escrow | `submit_delivery_proof(trade_id, record_id)` | trade, Delivery proof block |
| Escrow | `set_unboxing_media(trade_id, cid)` | trade, buyer |
| Escrow | `open_dispute(trade_id, claim_kind, statement, cid)`, payable | trade, buyer |
| Escrow | `respond_to_dispute(trade_id, statement, cid)`, payable | trade, seller |
| Arbiter | `resolve(trade_id)` | trade, either party |

The existing claim buttons stay; each is enabled from the window it depends
on, since nothing closes a window by itself.

**Delivery proof block** on the trade page. For the seller in `SHIPPED`: a
link to https://lacre.in-sidr.xyz to attest the carrier's email with their
wallet, a field for the record id, and the submit button. For everyone, once
set: the record read through the Router at `LATEST_FINAL` (domain, selector,
key bits, `signed_at`, valid, aligned, requester) with an explorer link built
from the Verifier address the Router resolves now. A record not yet readable
at `LATEST_FINAL` is shown as provisional and cannot be submitted; Lacre
records take about 35 minutes to finalize. The block states in one line what
the proof shows: the carrier's system emailed the seller after payment, not
that the parcel was delivered.

**Deployment.** Every deploy through
`experiments/wasm-deploy-probe/deploy_bradbury.py`: estimate, refuse over the
cap, sign at 3x clamped to 2^24, print the L2 hash before broadcast. The
frontend's network config gains the Escrow, Arbiter and Router addresses.

--------------------------------------------------------------------------------
## 5. Out of scope

| feature | why not now | what would unblock it |
|---|---|---|
| Validator-verified tracking | Carriers refuse validators at the edge (418, 403, no receipt) | Primitive request 5 (headers and user agent for `web.render`) at the least; realistically carrier APIs with signed requests, or the `"dkim+extract"` lane binding the tracking number in the signed email |
| Private evidence | Calldata is public; no encryption to validators or private state | Primitive request 4 (private calldata, `PRIMITIVES_STUDY.md` D.10) |
| Automatic window closing | No timers; `emit` is one hop, not a clock | Primitive request 3 (self-scheduled execution at a deadline, C.9) |
| TLSNotary / Reclaim | The only verifier is 210,488 bytes, about fifteen times the gas cap; no native signature verification | Primitive request 9 (raise `max_tx_gas_limit`) and request 1 (native signature verification), section F |

--------------------------------------------------------------------------------
## 6. Order of work

1. `contracts/Escrow.py` with the dispute writes and the delivery proof
   block, and direct-mode tests for every transition, window and payout:
   `open_dispute` at and after `claim_at`, wrong bond, unknown claim kind,
   double response, response after the window, default judgment with and
   without the burden rules, `settle` from anyone but the Arbiter, a second
   `settle`. The Lacre Router and Verifier stubbed: valid, invalid, wrong
   domain, 1023-bit key, `signed_at` before `paid_at`, a record reused on a
   second trade. Gate: `estimate_source.py` at or under 18,000 bytes and
   15.25 million gas.
2. `contracts/Arbiter.py` and its tests against a stubbed Escrow view: every
   burden rule row, the refusal paths (not `DISPUTED`, no response when the
   jury is needed, unboxing window still open), and the `settle` it emits.
   The nondet block is tested by mocking fetch and prompt; its real test is
   step 4. Gate: under 15,000 bytes.
3. Size on every commit: `estimate_source.py` on both files (stripped output if
   they carry comments), numbers in the commit message; a commit that crosses a
   gate does not land.
4. `EscrowDemo.py` and `ArbiterDemo.py` on Bradbury through `deploy_bradbury.py`;
   `set_arbiter`; carrier domains. One full trade, all hashes recorded in the
   style of `docs/DEMO_RESULTS.md`: listing with an image, `mark_shipped` with a
   packing image and `amazon.com`, a delivery proof attested with Lacre and
   accepted, a NOT_AS_DESCRIBED dispute with an unboxing image, a response,
   `resolve` through the jury, `settle` on the Escrow, balances checked.
5. Frontend: pin route, media on listing and trade pages, the new writes, the
   Delivery proof block.
6. Production deploy of `Escrow.py` and `Arbiter.py` with production
   constants, wiring, addresses into `docs/ARCHITECTURE.md` and the README.
