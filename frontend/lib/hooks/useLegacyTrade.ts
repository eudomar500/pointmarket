"use client";

import { useQuery } from "@tanstack/react-query";
import { DEFAULT_NETWORK, type LegacyMarketplace } from "@/lib/genlayer/contracts";
import { getLegacyListingDetails, getLegacyTradeSummary } from "@/lib/genlayer/reads";
import { createReadClient } from "@/lib/genlayer/client";

/** One trade on a legacy v1.4.x Marketplace, as it was recorded there. */
export interface LegacyTradeDetail {
  id: number;
  title: string;
  description: string;
  seller: string;
  buyer: string;
  price: bigint;
  state: number;
  createdAt: number;
  paidAt: number;
  shippedAt: number;
  disputedAt: number;
  disputed: boolean;
  disputeInitiator: string;
  buyerBond: bigint;
  sellerBond: bigint;
  verdictBuyerWins: boolean;
  verdictReasoning: string;
  resolvedByDefault: boolean;
  trackingNumber: string;
  trackingCarrier: string;
  buyerEvidence: string;
  sellerEvidence: string;
}

export function useLegacyTrade(source: LegacyMarketplace | undefined, tradeId: number) {
  return useQuery<LegacyTradeDetail>({
    queryKey: ["legacy", source?.key ?? "none", "trade", tradeId],
    queryFn: async (): Promise<LegacyTradeDetail> => {
      if (!source) throw new Error("Unknown legacy marketplace");
      const client = createReadClient(DEFAULT_NETWORK);
      const [listing, summary] = await Promise.all([
        getLegacyListingDetails(client, source.address, tradeId),
        getLegacyTradeSummary(client, source.address, tradeId),
      ]);
      return {
        id: tradeId,
        title: listing.title,
        description: listing.description,
        seller: summary.seller,
        buyer: summary.buyer,
        price: BigInt(summary.price),
        state: Number(summary.state),
        createdAt: Number(summary.created_at),
        paidAt: Number(summary.paid_at),
        shippedAt: Number(summary.shipped_at),
        disputedAt: Number(summary.disputed_at),
        disputed: Boolean(summary.disputed),
        disputeInitiator: String(summary.dispute_initiator ?? ""),
        buyerBond: BigInt(summary.buyer_bond),
        sellerBond: BigInt(summary.seller_bond),
        verdictBuyerWins: Boolean(summary.llm_verdict_buyer_wins),
        verdictReasoning: String(summary.llm_verdict_reasoning ?? ""),
        resolvedByDefault: Boolean(summary.resolved_by_default),
        trackingNumber: String(listing.tracking_number ?? ""),
        trackingCarrier: String(listing.tracking_carrier ?? ""),
        buyerEvidence: String(listing.buyer_evidence ?? ""),
        sellerEvidence: String(listing.seller_evidence ?? ""),
      };
    },
    enabled: Boolean(source),
    staleTime: 60_000,
  });
}
