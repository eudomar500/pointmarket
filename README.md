# Pointmarket

A P2P marketplace with escrow, built on [GenLayer](https://genlayer.com) Intelligent Contracts. Disputes are judged by GenLayer validators reading the photos. Prediction markets are coming soon.

Live app: https://pointmarket.in-sidr.xyz (Testnet Bradbury).

> **Status:** MVP. v1.5 runs on Testnet Bradbury as a demo contract pair with reduced timing
> constants, which the frontend targets by default. The production v1.5 pair is not deployed yet.
> Not audited. Not for production funds.

## What this is (v1.5)

v1.5 splits the trade into two contracts along the line between deterministic and non-deterministic code. The design, and the measurement behind each decision, is in [`docs/V15_ARCHITECTURE.md`](./docs/V15_ARCHITECTURE.md).

**Escrow** (`contracts/Escrow.py`). Holds all the money and the whole trade lifecycle: listing, payment, shipping, delivery, claims and refunds, each with its own window. Disputes are a statement plus a bond from each side: the buyer posts a fixed bond (0.01 GEN) on `open_dispute`, the seller posts 5% of the price on `respond_to_dispute`, and the loser forfeits their bond to the winner. Photos (listing, packing, unboxing) are anchored as raw CIDv1 on IPFS, so anyone can check the bytes a gateway returns against the CID without trusting the gateway. The Escrow never runs a model or a fetch, so a stalled jury cannot stall withdrawals, claims or other trades. Optionally, the seller can submit a delivery proof read from [Lacre](https://lacre.in-sidr.xyz). Interface: [`docs/ESCROW.md`](./docs/ESCROW.md).

**Arbiter** (`contracts/Arbiter.py`). Holds no funds and no trade state. `resolve(trade_id)`, callable by anyone, reads the disputed trade from the Escrow and applies burden rules first: a buyer who claims damage without an unboxing photo loses, a seller without a listing or packing photo cannot claim good condition, a "not received" claim against an accepted delivery proof loses. Only when both parties complied does it call the AI jury. The jury's verdict is sent to the Escrow as one `settle` message, emitted on finalization, so money moves only on a verdict that can no longer be appealed. Interface and prompt: [`docs/ARBITER.md`](./docs/ARBITER.md).

**The one-image jury.** Each `resolve` fetches exactly one image (the unboxing photo for `NOT_AS_DESCRIBED` and `DAMAGED`, the packing photo for `NOT_RECEIVED`), checks its sha256 against the CID, and asks the model for a closed label against the listing title and description (`MATCHES` / `DIFFERENT` / `UNCLEAR`, or `INTACT` / `DAMAGED` / `UNCLEAR`). The claimant carries the burden: only `DIFFERENT` (or `DAMAGED`) wins for the buyer. Validators compare the label and the digest result, not the reasoning text.

Why one image: every validator repeats the leader's vision call to check it. The first Arbiter (v150) sent two images per call, and on Bradbury its first `resolve` finalized as `VALIDATORS_TIMEOUT` (final round 6 `TIMEOUT` vs 5 `AGREE`, no `settle` emitted), and the retry lost its first leader to `LEADER_TIMEOUT` before reaching consensus. Arbiter v151 sends one image per call and reached `AGREE` on the first round with no timeouts. See [`docs/DEMO_RESULTS.md`](./docs/DEMO_RESULTS.md), "Findings".

**Delivery proof (optional).** The seller attests the carrier's DKIM-signed email on Lacre and submits the record id. The Escrow accepts it when the record is signed by one of the trade's carrier domains with a key of at least 1024 bits, was signed after the buyer paid, and has not served another trade. An accepted proof shortens the seller's claim window and defeats a bare `NOT_RECEIVED` claim by rule.

- It proves the carrier's system sent the seller a message after the buyer paid, and that the seller holds it. A forged or edited email fails the signature.
- It does not prove the message is about this parcel (only headers are checked), that it says "delivered", or what was in the box. Condition is the photos' job.

In plain terms: the buyer's payment is already locked in the Escrow. A delivery proof does not release it; it shortens the wait before the seller can claim it, from 7 days after shipping to 72 hours after the proof in production (1 hour to 10 minutes in the demo build), because a carrier's signed shipping email sent after payment backs the seller. That same instant is the buyer's dispute deadline, so the buyer still gets 72 hours from the proof (or the rest of the original 7 days, if that ends sooner). `DAMAGED` and `NOT_AS_DESCRIBED` claims still go to the Arbiter as before; only a `NOT_RECEIVED` claim is decided against the buyer by rule.

The delivery proof is implemented and covered by direct-mode tests with a stubbed Lacre Router and Verifier. Its first live run on Bradbury passed on 2026-10-02 with a Gmail message standing in for a carrier: the proof was accepted, the claim window moved from 1 hour after shipping to 10 minutes after the proof, and the seller claimed 44 minutes earlier than without it. See [`docs/DEMO_RESULTS.md`](./docs/DEMO_RESULTS.md), "Run 3: Lacre delivery proof". The test build is in [`experiments/lacre-proof/`](./experiments/lacre-proof/). A run with a real carrier's email is still to do.

## Prediction markets (coming soon)

`PredictionMarket.py` v1.1.5 is deployed on Testnet Bradbury and works against the v1.4.7 Marketplace. It is not wired to the v1.5 Escrow, and the app does not expose it.

Binary markets resolve against on-chain marketplace state, in two categories:

- **Objective markets:** resolve numerically from windowed marketplace metrics (trade count, volume, dispute rate, average price). No LLM involved.
- **Subjective markets:** resolve via LLM consensus on a specific trade's outcome (was the description honest? is the seller trustworthy based on history?).

Design: [`docs/PREDICTION_MARKET_DESIGN.md`](./docs/PREDICTION_MARKET_DESIGN.md).

## Why GenLayer

Dispute resolution needs judgment: does this photo show the item in the listing? Solidity cannot make that call without an external oracle or a human arbiter, and both centralize the trust model.

GenLayer's [Optimistic Democracy](https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/optimistic-democracy) makes the validator quorum itself the arbiter. In v1.5 each validator fetches the anchored photo from an IPFS gateway, checks it against its CID, and runs the vision call itself; the verdict stands only if they agree. That replaces the centralized resolution layer that existing P2P escrows ([Kleros](https://kleros.io), [Binance P2P](https://p2p.binance.com)) require.

## Architecture

```
             seller / buyer                          anyone
                   |                                   |
                   v                                   v resolve(trade_id)
   +---------------------------------+      +---------------------------+
   | Escrow.py                       |      | Arbiter.py                |
   | trades, state machine, windows, |<-----| no trade state; burden    |
   | all money, CIDs, delivery proof,|view, | rules and jury (nondet)   |
   | disputes: statements and bonds  |FINAL |                           |
   |                                 |      |                           |
   | settle: only from arbiter       |<=====| emit on='finalized'       |
   +----------------+----------------+      +-------------+-------------+
                    | view, LATEST_FINAL                  | one image, sha256 = CID
                    v                                     v
   Lacre Router 0xEf37cb72C3A9dD6bCE2f3575B75c94C555F9c8d9
     -> resolve("verifier")                IPFS gateways: ipfs.filebase.io,
                                           then gateway.pinit.io
```

Deploy order: Escrow, then Arbiter with the Escrow address in its constructor, then `Escrow.set_arbiter(arbiter)`, which is one-shot. The frontend pins photos through Filebase and displays them from the same gateway the jury reads.

- Design and measurements: [`docs/V15_ARCHITECTURE.md`](./docs/V15_ARCHITECTURE.md)
- Escrow interface and build: [`docs/ESCROW.md`](./docs/ESCROW.md)
- Arbiter interface, prompt and build: [`docs/ARBITER.md`](./docs/ARBITER.md)
- v1.4.7 Marketplace and PredictionMarket: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)

## Deployed contracts

**Testnet Bradbury (Chain ID 4221) - v1.5 active demo pair:**

| Contract | Address | Version |
|---|---|---|
| EscrowDemo | `0xA8a745389ba94E1915789b0b7a7aB8c0eEeD68B3` | 950 |
| Arbiter | `0xbd5CEABE0cFCF5c4Ae569D027ca9275D1F511fe8` | 151 |

This is the pair the app uses by default: `frontend/lib/genlayer/contracts.ts` sets `DEFAULT_NETWORK = "testnetBradburyDemo"`. `EscrowDemo.py` is generated from `Escrow.py` by `scripts/make_escrow_demo.py`; only the version number and the window constants differ (1 hour dispute and response windows instead of 7 and 14 days, for example).

**Testnet Bradbury (Chain ID 4221) - v1.5 first pair, retired:**

| Contract | Address | Version |
|---|---|---|
| EscrowDemo | `0xD637Af7BbFeD058EaD69D5639dfD7Ff5cDb2E614` | 950 |
| Arbiter | `0xcfc12380da88d2B11eE8a41D781FEF9cbfad438c` | 150 |

Replaced because `set_arbiter` is one-shot, so moving to Arbiter v151 meant redeploying the Escrow. 0.015 GEN is stranded in this EscrowDemo from a payable call that reverted (see `docs/DEMO_RESULTS.md`, Finding 3).

**v1.5 production pair:** not deployed yet.

**Testnet Bradbury (Chain ID 4221) - legacy v1.4.7 production:**

| Contract | Address | Version |
|---|---|---|
| Marketplace | `0x68546F0a8d2Af91d5917A03245c1D31296487b3F` | 1.4.7 |
| PredictionMarket | `0x10717D9814Ace2098862299C26806a2899eAB204` | 1.1.5 |

**Testnet Bradbury (Chain ID 4221) - legacy demo, reduced timing constants:**

| Contract | Address | Version |
|---|---|---|
| MarketplaceDemo | `0xB84B0683618898769EaCdca7062f9439510878CE` | 903 |
| PredictionMarketDemo | `0x82d83E3354A1896EA87684ADE9892834e52f1c0a` | 902 |

Each legacy Bradbury pair is wired:
- `Marketplace.authorized_fee_sender` points at the PredictionMarket of the same pair.
- `PredictionMarket.marketplace_address` points at the Marketplace of the same pair (one-shot, immutable).

For these four deployments the `CONTRACT_VERSION` constants were read back on-chain through each contract's `get_contract_info()` view and match the source: 147, 115, 903, and 902. `Marketplace.py` v1.4.7 is 35,650 bytes and over the Bradbury per-transaction gas cap, so it cannot be redeployed (`docs/V15_ARCHITECTURE.md`, section 1).

**Studionet (Chain ID 61999) - legacy:**

| Contract | Address | Version |
|---|---|---|
| Marketplace | `0x29f58D5ACC8b85250D3Dae2692DEADED346c6e67` | 1.4.4 |
| PredictionMarket | `0x2b0B5f76Db290D77DF53250B7f0540fc2D8cb48E` | 1.0.4 |

The source for 1.4.4 and 1.0.4 is no longer in the tree. These addresses are retained as historical reference for the entries in `CHANGELOG.md`.

## Live demo

Two v1.5 runs on Testnet Bradbury, each carrying one trade through a `NOT_AS_DESCRIBED` dispute to a jury verdict and a `settle` on the Escrow:

- **Run 1, 2026-10-01, Arbiter v150 (two images).** The first `resolve` finalized as `VALIDATORS_TIMEOUT` with no `settle`; the retry reached consensus. Seller won and was paid 0.113 GEN (0.1 GEN price, minus the 2% fee, plus both bonds).
- **Run 2, 2026-10-02, Arbiter v151 (one image).** Trade "Desk lamp" with the IPFS logo as the unboxing photo. `resolve` reached `AGREE` on the first round with no timeouts. Buyer won and was paid 0.115 GEN (the full price plus both bonds, no fee).

Every transaction hash, the settlement figures and the findings are in [`docs/DEMO_RESULTS.md`](./docs/DEMO_RESULTS.md).

Earlier runs, on the v1.4 contracts: on Studionet on May 17, 2026, a Marketplace trade ran the happy path and two subjective prediction markets over it resolved to YES by five-validator consensus, with 0.03 GEN of fees forwarded cross-contract (also in `docs/DEMO_RESULTS.md`). On Bradbury on May 28, 2026, trade #2 on `MarketplaceDemo v903` ran from `create_listing` through `open_dispute`, `respond_to_dispute` and an LLM verdict (`buyer_wins = true`); hashes are in `CHANGELOG.md` under "Demo contracts v903".

## Repository structure

```
.
|-- contracts/
|   |-- Escrow.py                 v1.5 Escrow, version 150, production constants, 560 lines
|   |-- EscrowDemo.py             generated from Escrow.py, version 950, demo windows, 560 lines
|   |-- Arbiter.py                v1.5 Arbiter, version 151, one-image jury, 288 lines
|   |-- Marketplace.py            legacy v1.4.7, 949 lines
|   |-- MarketplaceDemo.py        legacy v903, 953 lines
|   |-- PredictionMarket.py       v1.1.5, 880 lines
|   `-- PredictionMarketDemo.py   v902, 885 lines
|-- tests/
|   |-- test_escrow.py            65 direct-mode tests
|   `-- test_arbiter.py           63 direct-mode tests
|-- scripts/
|   |-- make_escrow_demo.py       generates EscrowDemo.py from Escrow.py (--check for staleness)
|   `-- write_bradbury.py         one write transaction on Bradbury, with --value for payable calls
|-- experiments/
|   |-- wasm-deploy-probe/        gas cap findings and deploy_bradbury.py (stripped source, constructor args)
|   |-- media-probe/              can validators read an image from an IPFS gateway
|   |-- tracking-probe/           can validators read carrier tracking pages (they cannot)
|   `-- lacre-proof/              Escrow build that accepts gmail.com, for the first delivery proof run
|-- docs/
|   |-- V15_ARCHITECTURE.md       v1.5 design and the measurements behind it
|   |-- ESCROW.md                 v1.5 Escrow interface and build steps
|   |-- ARBITER.md                v1.5 Arbiter interface, prompt and build steps
|   |-- DEMO_RESULTS.md           on-chain evidence: v1.5 Bradbury runs, v1.4 Studionet run
|   |-- PRIMITIVES_STUDY.md       runtime primitives measured against Bradbury
|   |-- ARCHITECTURE.md           v1.4.7 topology, cross-contract pattern, state machines
|   |-- PREDICTION_MARKET_DESIGN.md   storage, API, settlement logic, bug audit
|   |-- SECURITY.md               v1.4.7 threat model
|   |-- TX_LIFECYCLE.md           transaction tracking across the Finality Window
|   |-- SETUP.md                  local development setup
|   `-- FUTURE_FIAT_ESCROW.md     roadmap: fiat-leg integration
|-- frontend/                     Next.js app: marketplace, trade page, IPFS photo pinning, wallet, TX tracking
|-- CHANGELOG.md                  version history per contract
|-- LICENSE                       MIT
`-- README.md                     this file
```

## Documentation

- **How does v1.5 work, and why?** -> `docs/V15_ARCHITECTURE.md`
- **What does the Escrow / Arbiter expose?** -> `docs/ESCROW.md`, `docs/ARBITER.md`
- **What's been validated on-chain?** -> `docs/DEMO_RESULTS.md`
- **How does the PredictionMarket work?** -> `docs/PREDICTION_MARKET_DESIGN.md`
- **How do I run this locally?** -> `docs/SETUP.md`
- **What's the version history?** -> `CHANGELOG.md`

## Status and roadmap

**Done:**

- v1.5 contracts: `Escrow.py`, `EscrowDemo.py` and `Arbiter.py` (v151, one-image jury).
- 128 direct-mode tests (65 Escrow, 63 Arbiter), passing.
- Both verdict directions on Bradbury: seller won (Run 1) and buyer won (Run 2), each settled on the Escrow.
- Frontend ported to v1.5 and live at https://pointmarket.in-sidr.xyz, with photos pinned to IPFS.

**Pending:**

- Lacre delivery proof with a real carrier's email on Bradbury (the Gmail stand-in run passed, Run 3).
- Production v1.5 pair (`Escrow.py` and `Arbiter.py` with production constants).
- Wiring prediction markets to the v1.5 Escrow.
- Reputation views: read-only views over the Escrow.
- Independent security review.

**Out of scope for v1.5** (see `docs/V15_ARCHITECTURE.md`, section 5):

- Validator-verified tracking: carriers refuse validators at the edge.
- Private evidence: calldata is public, and so are the photos behind the CIDs.
- Automatic window closing: there are no timers, so each window is closed by a call.
- Fiat settlement layer. See `docs/FUTURE_FIAT_ESCROW.md`.

## License

MIT. See `LICENSE`.

Built by Insidr Labs.
