import {
  ClaimKind,
  TradeState,
  type EscrowTrade,
  type EscrowTradeRaw,
} from "./types";

/**
 * Constants and pure helpers mirrored from Escrow.py and Arbiter.py (v1.5).
 * Everything here is deterministic and runs without a network call; the
 * pre-checks in precheck.ts and the UI both build on it.
 */

export const FEE_BPS = 200n;
export const SELLER_BOND_BPS = 500n;
export const PENALTY_BPS = 500n;
export const BPS = 10_000n;
/** Fixed buyer bond on open_dispute: 10^16 wei, 0.01 GEN. */
export const BUYER_BOND = 10n ** 16n;
export const MIN_PRICE = 10n ** 15n;
export const MAX_PRICE = 10n ** 30n;

/** Escrow.CARRIER_DOMAINS. get_contract_info returns the live list. */
export const CARRIER_DOMAINS = ["amazon.com", "ups.com", "fedex.com", "dhl.com"] as const;
export const MAX_CARRIER_DOMAINS = 3;

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 2000;
export const STATEMENT_MAX = 2000;
export const TRACKING_MIN = 4;
export const TRACKING_MAX = 100;
export const CARRIER_MIN = 1;
export const CARRIER_MAX = 50;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function sellerBond(price: bigint): bigint {
  return (price * SELLER_BOND_BPS) / BPS;
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function wei(v: unknown): bigint {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

export function parseEscrowTrade(raw: EscrowTradeRaw, fallbackId: number): EscrowTrade {
  return {
    id: raw.trade_id !== undefined ? num(raw.trade_id) : fallbackId,
    seller: str(raw.seller),
    buyer: str(raw.buyer),
    price: wei(raw.price),
    feeAmount: wei(raw.fee_amount),
    title: str(raw.listing_title),
    description: str(raw.listing_description),
    listingMediaCid: str(raw.listing_media_cid),
    createdAt: num(raw.created_at),
    state: num(raw.state),
    paidAt: num(raw.paid_at),
    trackingNumber: str(raw.tracking_number),
    trackingCarrier: str(raw.tracking_carrier),
    carrierDomains: str(raw.carrier_domains),
    packingMediaCid: str(raw.packing_media_cid),
    shippedAt: num(raw.shipped_at),
    deliveryProof: str(raw.delivery_proof),
    proofKind: str(raw.proof_kind),
    proofAt: num(raw.proof_at),
    deliveredAt: num(raw.delivered_at),
    unboxingMediaCid: str(raw.unboxing_media_cid),
    disputedAt: num(raw.disputed_at),
    claimKind: num(raw.claim_kind),
    buyerEvidence: str(raw.buyer_evidence),
    buyerBond: wei(raw.buyer_bond),
    sellerEvidence: str(raw.seller_evidence),
    sellerResponseCid: str(raw.seller_response_cid),
    sellerBond: wei(raw.seller_bond),
    responded: Boolean(raw.responded),
    wasDisputed: Boolean(raw.was_disputed),
    buyerWins: Boolean(raw.buyer_wins),
    resolvedByDefault: Boolean(raw.resolved_by_default),
    verdictHash: str(raw.verdict_hash),
    claimAt: num(raw.claim_at),
    responseUntil: num(raw.response_until),
    unboxingUntil: num(raw.unboxing_until),
    buyerFirstSeen: num(raw.buyer_first_seen),
    sellerFirstSeen: num(raw.seller_first_seen),
  };
}

/** A listing that no buyer has accepted stores the seller as buyer. */
export function hasBuyer(trade: Pick<EscrowTrade, "buyer" | "seller">): boolean {
  return Boolean(trade.buyer) && !sameAddress(trade.buyer, trade.seller);
}

/**
 * Arbiter.RULES, copied verbatim. A rule verdict stores sha256 of one of
 * these strings as verdict_hash, so the hash names the rule that decided.
 */
export const RULE_TEXT: Record<string, string> = {
  R1: "R1: not received, against an accepted delivery proof. Seller wins.",
  R2: "R2: damage or mismatch alleged without an unboxing image. Seller wins.",
  R4: "R4: mismatch alleged and the seller anchored no listing image. Buyer wins.",
  R5: "R5: damage alleged and the seller anchored no packing image. Buyer wins.",
  R6: "R6: not received and the seller anchored no packing image. Buyer wins.",
};

/** Which photo the jury reads for each claim kind (Arbiter.IMAGE_ROLE). */
export const JURY_IMAGE_ROLE: Record<number, "unboxing" | "packing"> = {
  [ClaimKind.NOT_AS_DESCRIBED]: "unboxing",
  [ClaimKind.DAMAGED]: "unboxing",
  [ClaimKind.NOT_RECEIVED]: "packing",
};

export type BurdenOutcome =
  | { kind: "rule"; rule: string; buyerWins: boolean }
  | { kind: "wait"; rule: string }
  | { kind: "jury" }
  | { kind: "invalid" };

/** Arbiter._rule, first match decides. */
export function burdenRule(trade: EscrowTrade, now: number): BurdenOutcome {
  const kind = trade.claimKind;
  if (kind === ClaimKind.NOT_RECEIVED) {
    if (trade.proofKind) return { kind: "rule", rule: "R1", buyerWins: false };
    if (!trade.packingMediaCid) return { kind: "rule", rule: "R6", buyerWins: true };
    return { kind: "jury" };
  }
  if (kind !== ClaimKind.DAMAGED && kind !== ClaimKind.NOT_AS_DESCRIBED) {
    return { kind: "invalid" };
  }
  if (!trade.unboxingMediaCid) {
    if (now < trade.unboxingUntil) return { kind: "wait", rule: "R3" };
    return { kind: "rule", rule: "R2", buyerWins: false };
  }
  if (kind === ClaimKind.NOT_AS_DESCRIBED && !trade.listingMediaCid) {
    return { kind: "rule", rule: "R4", buyerWins: true };
  }
  if (kind === ClaimKind.DAMAGED && !trade.packingMediaCid) {
    return { kind: "rule", rule: "R5", buyerWins: true };
  }
  return { kind: "jury" };
}

export interface Readiness {
  ready: boolean;
  reason: string;
}

/**
 * Whether Arbiter.resolve would get past its refusals right now, and why
 * not. `trade` must be the LATEST_FINAL view, which is what the Arbiter
 * reads.
 */
export function resolveReadiness(
  trade: EscrowTrade,
  now: number,
  arbiterPaused: boolean,
  formatTime: (unix: number) => string,
): Readiness {
  if (trade.state !== TradeState.DISPUTED) {
    return { ready: false, reason: "Only a disputed trade can be resolved." };
  }
  if (arbiterPaused) {
    return { ready: false, reason: "The Arbiter is paused by its admin." };
  }
  const outcome = burdenRule(trade, now);
  switch (outcome.kind) {
    case "invalid":
      return { ready: false, reason: "The dispute has an unknown claim kind." };
    case "wait":
      return {
        ready: false,
        reason: `The buyer can still add the unboxing photo until ${formatTime(trade.unboxingUntil)}. Resolve opens then (rule R3).`,
      };
    case "rule":
      return {
        ready: true,
        reason: `Rule ${outcome.rule} decides without the jury: ${outcome.buyerWins ? "buyer" : "seller"} wins.`,
      };
    case "jury": {
      if (!trade.responded) {
        if (now < trade.responseUntil) {
          return {
            ready: false,
            reason: `Waiting for the seller's response until ${formatTime(trade.responseUntil)}. Without one, the buyer wins by default after that.`,
          };
        }
        return {
          ready: false,
          reason: "The seller did not respond in time. This dispute closes by default judgment, which the buyer claims.",
        };
      }
      const role = JURY_IMAGE_ROLE[trade.claimKind];
      return {
        ready: true,
        reason: `The jury checks the ${role} photo against the listing.`,
      };
    }
  }
}

/** Escrow.claim_dispute_default refuses when R1, R2 or R3 would hold. */
export function defaultJudgmentBlocked(trade: EscrowTrade): boolean {
  if (trade.claimKind === ClaimKind.NOT_RECEIVED) return Boolean(trade.proofKind);
  return !trade.unboxingMediaCid;
}

/** sha256 hex of a UTF-8 string, in the browser. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The rule whose fixed reasoning hashes to verdictHash, or null (jury). */
export async function ruleForVerdictHash(verdictHash: string): Promise<string | null> {
  if (!verdictHash) return null;
  for (const [rule, text] of Object.entries(RULE_TEXT)) {
    if ((await sha256Hex(text)) === verdictHash.toLowerCase()) return rule;
  }
  return null;
}
