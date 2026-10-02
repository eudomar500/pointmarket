import type { Address as ViemAddress } from "viem";

/**
 * Type mirrors for Escrow.py, Arbiter.py, PredictionMarket.py and the legacy
 * Marketplace.py contract responses. Field names match the Python contracts
 * exactly to avoid mapping logic.
 *
 * Address is re-exported from viem because genlayer-js uses viem's nominal
 * Address type internally. Using viem's type keeps everything assignable.
 */

export type Address = ViemAddress;

// Trade states (u8 enum mirrored from the Escrow; unchanged since v1.4.7).
export const TradeState = {
  LISTING_OPEN: 0,
  PAID: 1,
  SHIPPED: 2,
  DISPUTED: 3,
  COMPLETED: 4,
  CANCELLED: 5,
  REFUNDED: 6,
} as const;

export type TradeStateValue = (typeof TradeState)[keyof typeof TradeState];

export const TRADE_STATE_LABELS: Record<TradeStateValue, string> = {
  0: "LISTING OPEN",
  1: "PAID",
  2: "SHIPPED",
  3: "DISPUTED",
  4: "COMPLETED",
  5: "CANCELLED",
  6: "REFUNDED",
};

export const MarketState = {
  OPEN: 0,
  RESOLVED_YES: 1,
  RESOLVED_NO: 2,
  REFUNDED: 3,
} as const;

export type MarketStateValue = (typeof MarketState)[keyof typeof MarketState];

export const MARKET_STATE_LABELS: Record<MarketStateValue, string> = {
  0: "OPEN",
  1: "RESOLVED YES",
  2: "RESOLVED NO",
  3: "REFUNDED",
};

export const SubjectiveMetric = {
  TRADE_DESCRIPTION_HONEST: 100,
  SELLER_TRUSTWORTHY: 101,
} as const;

export type SubjectiveMetricValue =
  (typeof SubjectiveMetric)[keyof typeof SubjectiveMetric];

export const ObjectiveMetric = {
  VOLUME_THRESHOLD: 0,
  DISPUTE_RATE_BELOW: 1,
  AVG_PRICE_ABOVE: 2,
  TRADE_COUNT_ABOVE: 3,
} as const;

// Escrow claim kinds, set by the buyer in open_dispute.
export const ClaimKind = {
  NOT_RECEIVED: 1,
  DAMAGED: 2,
  NOT_AS_DESCRIBED: 3,
} as const;

export type ClaimKindValue = (typeof ClaimKind)[keyof typeof ClaimKind];

export const CLAIM_KIND_LABELS: Record<ClaimKindValue, string> = {
  1: "Not received",
  2: "Damaged",
  3: "Not as described",
};

/**
 * Escrow.get_trade(trade_id), as genlayer-js returns it: addresses and wei
 * as strings, times and kinds as numbers. Every TradeData field plus the
 * derived trade_id, claim_at, response_until, unboxing_until and the
 * first_seen pair.
 */
export interface EscrowTradeRaw {
  seller: string;
  buyer: string;
  price: string;
  fee_amount: string;
  listing_title: string;
  listing_description: string;
  listing_media_cid: string;
  created_at: number;
  state: number;
  paid_at: number;
  tracking_number: string;
  tracking_carrier: string;
  carrier_domains: string;
  packing_media_cid: string;
  shipped_at: number;
  delivery_proof: string;
  proof_kind: string;
  proof_at: number;
  delivered_at: number;
  unboxing_media_cid: string;
  disputed_at: number;
  claim_kind: number;
  buyer_evidence: string;
  buyer_bond: string;
  seller_evidence: string;
  seller_response_cid: string;
  seller_bond: string;
  responded: boolean;
  was_disputed: boolean;
  buyer_wins: boolean;
  resolved_by_default: boolean;
  verdict_hash: string;
  trade_id: string;
  claim_at: number;
  response_until: number;
  unboxing_until: number;
  buyer_first_seen: number;
  seller_first_seen: number;
}

/** EscrowTradeRaw with wei as bigint and every number coerced. */
export interface EscrowTrade {
  id: number;
  seller: string;
  buyer: string;
  price: bigint;
  feeAmount: bigint;
  title: string;
  description: string;
  listingMediaCid: string;
  createdAt: number;
  state: number;
  paidAt: number;
  trackingNumber: string;
  trackingCarrier: string;
  carrierDomains: string;
  packingMediaCid: string;
  shippedAt: number;
  deliveryProof: string;
  proofKind: string;
  proofAt: number;
  deliveredAt: number;
  unboxingMediaCid: string;
  disputedAt: number;
  claimKind: number;
  buyerEvidence: string;
  buyerBond: bigint;
  sellerEvidence: string;
  sellerResponseCid: string;
  sellerBond: bigint;
  responded: boolean;
  wasDisputed: boolean;
  buyerWins: boolean;
  resolvedByDefault: boolean;
  verdictHash: string;
  claimAt: number;
  responseUntil: number;
  unboxingUntil: number;
  buyerFirstSeen: number;
  sellerFirstSeen: number;
}

export interface EscrowEligible {
  total: number;
  ids: number[];
}

export interface EscrowContractInfo {
  version: number;
  admin: string;
  pending_admin: string;
  paused: boolean;
  arbiter: string;
  router: string;
  carrier_domains: string[];
  upgrade_unlock_at: number;
  has_pending_upgrade: boolean;
  total_trades: string;
  fees_collected: string;
}

export interface ArbiterContractInfo {
  version: number;
  escrow: string;
  admin: string;
  pending_admin: string;
  paused: boolean;
}

/** Return value of Arbiter.resolve, readable in the resolve receipt. */
export interface ResolveResult {
  buyer_wins: boolean;
  reasoning: string;
}

/** Lacre Verifier get(id). `{}` (no `id`) for an unknown record. */
export interface LacreRecord {
  id?: string;
  domain: string;
  selector: string;
  bh: string;
  body_canon: string;
  message_id_sha256: string;
  key_bits: string;
  key_sha256: string;
  valid: boolean;
  reason: string;
  from_domain: string;
  aligned: boolean;
  signed_at: string;
  source: string;
  requester: string;
  attested_at: string;
  fee_paid: string;
  schema_version: string;
}

// Legacy v1.4.x Marketplace views, read only.

export interface LegacyTradeSummary {
  seller: Address;
  buyer: Address;
  price: string;
  fee_amount: string;
  state: TradeStateValue;
  created_at: number;
  paid_at: number;
  shipped_at: number;
  delivered_at: number;
  disputed_at: number;
  disputed: boolean;
  dispute_initiator: Address;
  buyer_bond: string;
  seller_bond: string;
  llm_verdict_buyer_wins: boolean;
  llm_verdict_reasoning: string;
  resolved_by_default: boolean;
}

export interface LegacyListingDetails {
  seller: Address;
  title: string;
  description: string;
  price: string;
  state: TradeStateValue;
  created_at: number;
  tracking_number: string;
  tracking_carrier: string;
  buyer_evidence: string;
  seller_evidence: string;
}

export interface LegacyMetrics {
  total_trades_created: string;
}

export interface ContractInfo {
  admin: Address;
  paused: boolean;
  version: number;
  marketplace_address?: Address;
  total_markets?: string;
}

export interface MarketSummary {
  exists: boolean;
  creator: Address;
  question: string;
  metric_type: number;
  threshold: string;
  target_trade_id: string;
  window_start: number;
  window_end: number;
  betting_close_at: number;
  settlement_at: number;
  state: MarketStateValue;
  yes_pool: string;
  no_pool: string;
  fee_forwarded: string;
  llm_resolution_reasoning: string;
  created_at: number;
  resolved_at: number;
}

export interface UserBet {
  exists: boolean;
  yes_amount: string;
  no_amount: string;
  claimed: boolean;
}

export interface UserReputation {
  correct_predictions: string;
  total_predictions: string;
}

export const TxPhase = {
  IDLE: "idle",
  SIGNING: "signing",
  PENDING: "pending",
  PROPOSING: "proposing",
  COMMITTING: "committing",
  REVEALING: "revealing",
  ACCEPTED: "accepted",
  FINALIZED: "finalized",
  ERROR: "error",
} as const;

export type TxPhaseValue = (typeof TxPhase)[keyof typeof TxPhase];

export const TX_PHASE_LABELS: Record<TxPhaseValue, string> = {
  idle: "Submit",
  signing: "Confirm in wallet...",
  pending: "Transaction submitted...",
  proposing: "Validators proposing outcome...",
  committing: "Validators committing votes...",
  revealing: "Validators revealing votes...",
  accepted: "Accepted by consensus",
  finalized: "Finalized",
  error: "Transaction failed",
};
