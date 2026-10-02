"use client";

import { useWriteWithTracking } from "@/lib/tx/useWriteWithTracking";
import { forceRefundStuckDispute as forceRefundStuckDisputeWrite } from "@/lib/genlayer/writes";

/**
 * Escrow force_refund_stuck_dispute. Admin only, from disputed_at +
 * ADMIN_FORCE_REFUND_DELAY. Splits the price 50/50 and returns each bond
 * to its poster; the trade moves to REFUNDED with no winner.
 */
export function useForceRefundStuckDispute() {
  const { execute, pending, error } = useWriteWithTracking();

  const forceRefundStuckDispute = async (tradeId: number): Promise<string> =>
    execute({
      method: "force_refund_stuck_dispute",
      context: `Trade #${tradeId}`,
      write: (client, network) => forceRefundStuckDisputeWrite(client, network, BigInt(tradeId)),
    });

  return { forceRefundStuckDispute, pending, error };
}
