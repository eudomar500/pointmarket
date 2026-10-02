"use client";

import { useWriteWithTracking } from "@/lib/tx/useWriteWithTracking";
import { claimStuckDisputeRefund as claimStuckDisputeRefundWrite } from "@/lib/genlayer/writes";

/**
 * Escrow claim_stuck_dispute_refund. Anyone, from disputed_at +
 * PUBLIC_FORCE_REFUND_DELAY. Same split as the admin path: price 50/50
 * and each bond back to its poster.
 */
export function useClaimStuckDisputeRefund() {
  const { execute, pending, error } = useWriteWithTracking();

  const claimStuckDisputeRefund = async (tradeId: number): Promise<string> =>
    execute({
      method: "claim_stuck_dispute_refund",
      context: `Trade #${tradeId}`,
      write: (client, network) => claimStuckDisputeRefundWrite(client, network, BigInt(tradeId)),
    });

  return { claimStuckDisputeRefund, pending, error };
}
