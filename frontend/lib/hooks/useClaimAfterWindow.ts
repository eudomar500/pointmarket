"use client";

import { useWriteWithTracking } from "@/lib/tx/useWriteWithTracking";
import { claimAfterWindow as claimAfterWindowWrite } from "@/lib/genlayer/writes";

/**
 * Escrow claim_after_window. Seller only, on a SHIPPED trade, from
 * claim_at: shipped_at + DISPUTE_WINDOW, or proof_at + PROOF_CLAIM_DELAY
 * when an accepted delivery proof makes that earlier. Pays the seller the
 * price minus the fee.
 */
export function useClaimAfterWindow() {
  const { execute, pending, error } = useWriteWithTracking();

  const claimAfterWindow = async (tradeId: number): Promise<string> =>
    execute({
      method: "claim_after_window",
      context: `Trade #${tradeId}`,
      write: (client, network) => claimAfterWindowWrite(client, network, BigInt(tradeId)),
    });

  return { claimAfterWindow, pending, error };
}
