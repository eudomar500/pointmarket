# Pointmarket

A trust-minimized P2P marketplace with an integrated meta-prediction market, built on [GenLayer](https://genlayer.com) Intelligent Contracts.

> **Status:** MVP. Live on Testnet Bradbury: the production contract pair plus a demo pair
> with reduced timing constants, which the frontend targets by default. Studionet is legacy.
> Not audited. Not for production funds.

## What this is

Two contracts that share one substrate:

**1. Escrow-backed P2P marketplace.** Buyers and sellers transact physical goods peer-to-peer. Payment is locked in the contract until delivery is confirmed. When disputes occur, an AI-validator quorum reads both parties' evidence and adjudicates. No human arbiter, no centralized appeals.

**2. Meta-prediction market over marketplace activity.** Binary prediction markets resolve against on-chain Marketplace state. Two categories of markets are supported:

- **Objective markets:** resolve numerically by reading windowed metrics from the Marketplace (trade count, volume, dispute rate, average price). No LLM involved.
- **Subjective markets:** resolve via LLM consensus evaluating a specific trade's outcome (was the description honest? is the seller trustworthy based on history?).

The two contracts compound: the marketplace generates the verifiable data substrate, and the prediction market gives the marketplace a second usage primitive. 1% of each market's pool is forwarded to the marketplace as fee, creating revenue coupling between the two products.

## Why GenLayer

This design is intractable on EVM and tractable on GenLayer for one specific reason: **both dispute resolution and subjective market resolution require natural-language judgment.** Solidity cannot make those calls without an external oracle or human arbiter, and both centralize the trust model.

GenLayer's [Optimistic Democracy](https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/optimistic-democracy) makes the validator quorum itself the arbiter. The AI consensus replaces the centralized resolution layer that every existing P2P escrow ([Kleros](https://kleros.io), [Binance P2P](https://p2p.binance.com)) requires. The same primitive resolves prediction markets over subjective claims that Polymarket and Augur cannot host.

## Architecture

```
Marketplace.py (singleton, v1.4.7)
  - All trades stored in TreeMap[u256, TradeData]
  - LLM-arbitrated dispute resolution via gl.vm.run_nondet_unsafe
  - Window-aware metric views for prediction market queries
  - receive_fee() accepts cross-contract value from authorized PredictionMarket
       |
       | view + emit_transfer(value).receive_fee()
       |
PredictionMarket.py (singleton, v1.1.5)
  - All markets stored in TreeMap[u256, MarketData]
  - Reads Marketplace state at fixed address (set once, immutable)
  - Resolves objective markets locally via Marketplace views
  - Resolves subjective markets via LLM consensus
  - Forwards 1% of pool to Marketplace as fee on resolution
```

Both contracts are singletons (one deployment serves all trades / all markets), indexed by sequential IDs. The choice of singleton over factory is documented in `docs/ARCHITECTURE.md`.

## Deployed contracts

**Testnet Bradbury (Chain ID 4221) - production:**

| Contract | Address | Version |
|---|---|---|
| Marketplace | `0x68546F0a8d2Af91d5917A03245c1D31296487b3F` | 1.4.7 |
| PredictionMarket | `0x10717D9814Ace2098862299C26806a2899eAB204` | 1.1.5 |

**Testnet Bradbury Demo (Chain ID 4221) - reduced timing constants:**

| Contract | Address | Version |
|---|---|---|
| MarketplaceDemo | `0xB84B0683618898769EaCdca7062f9439510878CE` | 903 |
| PredictionMarketDemo | `0x82d83E3354A1896EA87684ADE9892834e52f1c0a` | 902 |

This is the pair the frontend uses by default: `frontend/lib/genlayer/contracts.ts` sets `DEFAULT_NETWORK = "testnetBradburyDemo"`.

**Studionet (Chain ID 61999) - legacy:**

| Contract | Address | Version |
|---|---|---|
| Marketplace | `0x29f58D5ACC8b85250D3Dae2692DEADED346c6e67` | 1.4.4 |
| PredictionMarket | `0x2b0B5f76Db290D77DF53250B7f0540fc2D8cb48E` | 1.0.4 |

The source for 1.4.4 and 1.0.4 is no longer in the tree. These addresses are retained as historical reference for the entries in `CHANGELOG.md`.

The Bradbury Demo deployment uses reduced timing constants (1 to 3 hours) calibrated for the live Finality Window of roughly 25 to 40 minutes. The dispute lifecycle has been exercised end-to-end with LLM resolution on this deployment. See `CHANGELOG.md` for the full transaction-level evidence.

Each Bradbury pair is wired:
- `Marketplace.authorized_fee_sender` points at the PredictionMarket of the same pair.
- `PredictionMarket.marketplace_address` points at the Marketplace of the same pair (one-shot, immutable).

For the four Bradbury deployments, whose source is in this repository, the `CONTRACT_VERSION` constants were read back on-chain through each contract's `get_contract_info()` view and match the source: 147, 115, 903, and 902.

## Live demo

A full end-to-end run was executed on Studionet on May 17, 2026. The on-chain evidence covers:

- One Marketplace trade (Sony WH-1000XM4 headphones, 1 GEN) created, paid, shipped, delivered (happy path with 0.98 GEN to seller and 0.02 GEN to fees).
- Two subjective PredictionMarket markets over that trade, both targeting metric `METRIC_LLM_TRADE_DESCRIPTION_HONEST`.
- Five-validator LLM consensus resolving both markets to YES, with independently produced reasoning strings.
- 0.03 GEN of total fees forwarded cross-contract from PredictionMarket to Marketplace via `receive_fee`.
- A losing-side claim attempt that correctly reverted, with all five validators agreeing on the protocol-level revert.

Full transaction-level evidence, validator quorums, LLM reasoning, threat model coverage matrix, and honest disclosure of paths NOT exercised: see [`docs/DEMO_RESULTS.md`](./docs/DEMO_RESULTS.md).

The demo contracts use reduced timing constants so that evaluators can observe a full lifecycle in a single session: 1 hour for the dispute, response, eligibility, and shipping windows, 2 hours for admin force refund, and 3 hours for public force refund. The values are calibrated to the roughly 25 to 40 minute Bradbury Finality Window; the earlier 5 to 15 minute demo timings were shorter than that window. `Marketplace.py` v1.4.7 and `PredictionMarket.py` v1.1.5 carry production timings. See the "Demo timings disclosure" section of `docs/PREDICTION_MARKET_DESIGN.md`.

A second validation run was executed on Testnet Bradbury on May 28, 2026, against `MarketplaceDemo v903`. Trade #2 (Rolex GMT Master, 0.001 GEN) was carried from `create_listing` through `open_dispute`, `respond_to_dispute`, and LLM verdict in a single session, with the seller and buyer each posting a 5% bond. The verdict was `buyer_wins = true`, reasoning string stored on-chain. Transaction hashes are listed in `CHANGELOG.md` under "Demo contracts v903".

## Repository structure

```
.
|-- contracts/
|   |-- Marketplace.py            v1.4.7, 949 lines
|   |-- MarketplaceDemo.py        v903, 953 lines
|   |-- PredictionMarket.py       v1.1.5, 880 lines
|   `-- PredictionMarketDemo.py   v902, 885 lines
|-- docs/
|   |-- ARCHITECTURE.md           system topology, cross-contract pattern, state machines
|   |-- PREDICTION_MARKET_DESIGN.md   storage, API, settlement logic, bug audit
|   |-- SECURITY.md               threat model (Marketplace T1-T9, PM T-PM-1..24, cross-contract T-CX-1..5)
|   |-- DEMO_RESULTS.md           on-chain evidence of the May 17, 2026 run
|   |-- TX_LIFECYCLE.md           transaction tracking across the Finality Window
|   |-- SETUP.md                  local development setup
|   `-- FUTURE_FIAT_ESCROW.md     roadmap: fiat-leg integration
|-- frontend/                     Next.js dApp (marketplace, trade detail, wallet, TX tracking)
|-- tests/                        README only for now
|-- scripts/                      README only for now
|-- CHANGELOG.md                  version history per contract
|-- LICENSE                       MIT
`-- README.md                     this file
```

## Documentation

All technical documentation is in `docs/`. Quick links:

- **What's the system architecture?** -> `docs/ARCHITECTURE.md`
- **How does the PredictionMarket work?** -> `docs/PREDICTION_MARKET_DESIGN.md`
- **What are the security guarantees?** -> `docs/SECURITY.md`
- **What's been validated on-chain?** -> `docs/DEMO_RESULTS.md`
- **How do I run this locally?** -> `docs/SETUP.md`
- **What's the version history?** -> `CHANGELOG.md`

## Status and roadmap

**Done:**

- Marketplace v1.4.7 and PredictionMarket v1.1.5 deployed on Testnet Bradbury.
- Marketplace happy path and dispute paths exercised on-chain (Studionet v1.4.4, Bradbury Demo v903).
- PredictionMarket subjective markets resolved end-to-end on Studionet v1.0.4.
- Cross-contract integration validated (read + value-transfer write).
- Threat model with 38 documented threats and mitigations.
- Bradbury Demo deployment (MarketplaceDemo v903 + PredictionMarketDemo v902) wired and operational.
- Dispute lifecycle exercised end-to-end on Bradbury with on-chain LLM verdict.
- Frontend Phase F: 12 of 24 writes integrated. Happy path (5 writes) validated in vivo. Disputes block (5 writes) integrated; `open_dispute` and `respond_to_dispute` validated in vivo on Bradbury Demo.

**Pending:**

- Run an objective market end-to-end (the path is implemented, not exercised).
- Run a `METRIC_LLM_SELLER_TRUSTWORTHY` market with multi-trade seller history.
- Exercise the three stuck-funds paths in vivo: `claim_dispute_default`, `force_refund_stuck_dispute`, `claim_stuck_dispute_refund`.
- Frontend: 12 writes pending (6 PredictionMarket, 6 admin).
- Independent security review.
- Permissionless market creation with creator bond.

**Out of scope for MVP** (deferred to future work):

- AMM-style pricing (LMSR, CPMM). MVP uses parimutuel pool-share pricing.
- Multi-outcome markets. MVP is binary YES/NO only.
- Off-chain claim markets. MVP markets are always over Marketplace state.
- Fiat settlement layer. See `docs/FUTURE_FIAT_ESCROW.md`.

## License

MIT. See `LICENSE`.
