import type { NetworkKey } from "./contracts";

/**
 * Escrow window constants. Mirrors `Escrow.py` (production) and
 * `EscrowDemo.py` v950 (demo, reduced windows).
 *
 * Most deadlines come from get_trade directly (claim_at, response_until,
 * unboxing_until); the constants here cover the ones it does not return:
 * the shipping deadline, the stuck-dispute delays and the unboxing window
 * of a trade that was never disputed.
 */
export interface EscrowTimings {
  disputeWindowSeconds: number;
  proofClaimDelaySeconds: number;
  unboxingWindowSeconds: number;
  disputeResponseWindowSeconds: number;
  maxShippingDelaySeconds: number;
  adminForceRefundDelaySeconds: number;
  publicForceRefundDelaySeconds: number;
}

const PRODUCTION: EscrowTimings = {
  disputeWindowSeconds: 7 * 86400,
  proofClaimDelaySeconds: 72 * 3600,
  unboxingWindowSeconds: 72 * 3600,
  disputeResponseWindowSeconds: 14 * 86400,
  maxShippingDelaySeconds: 30 * 86400,
  adminForceRefundDelaySeconds: 30 * 86400,
  publicForceRefundDelaySeconds: 90 * 86400,
};

const DEMO: EscrowTimings = {
  disputeWindowSeconds: 3600,
  proofClaimDelaySeconds: 600,
  unboxingWindowSeconds: 24 * 3600,
  disputeResponseWindowSeconds: 3600,
  maxShippingDelaySeconds: 3600,
  adminForceRefundDelaySeconds: 7200,
  publicForceRefundDelaySeconds: 10800,
};

const ESCROW_TIMINGS: Record<NetworkKey, EscrowTimings> = {
  studionet: DEMO,
  testnetAsimov: DEMO,
  testnetBradbury: PRODUCTION,
  testnetBradburyDemo: DEMO,
};

export function getEscrowTimings(network: NetworkKey): EscrowTimings {
  return ESCROW_TIMINGS[network];
}
