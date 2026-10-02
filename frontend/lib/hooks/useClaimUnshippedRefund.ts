"use client";

import { useWriteWithTracking } from "@/lib/tx/useWriteWithTracking";
import { claimUnshippedRefund as claimUnshippedRefundWrite } from "@/lib/genlayer/writes";

/**
 * Escrow claim_unshipped_refund. Buyer only, on a PAID trade, from
 * paid_at + MAX_SHIPPING_DELAY. Refunds the full price.
 */
export function useClaimUnshippedRefund() {
  const { execute, pending, error } = useWriteWithTracking();

  const claimUnshippedRefund = async (tradeId: number): Promise<string> =>
    execute({
      method: "claim_unshipped_refund",
      context: `Trade #${tradeId}`,
      write: (client, network) => claimUnshippedRefundWrite(client, network, BigInt(tradeId)),
    });

  return { claimUnshippedRefund, pending, error };
}
