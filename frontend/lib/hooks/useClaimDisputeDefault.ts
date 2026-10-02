"use client";

import { useWriteWithTracking } from "@/lib/tx/useWriteWithTracking";
import { claimDisputeDefault as claimDisputeDefaultWrite } from "@/lib/genlayer/writes";

/**
 * Escrow claim_dispute_default. Buyer only, on a DISPUTED trade the
 * seller did not answer, from response_until. Refused when burden rule
 * R1, R2 or R3 would hold (that case goes to Arbiter.resolve). Pays the
 * buyer the price and the bond minus a 5% penalty on the bond.
 */
export function useClaimDisputeDefault() {
  const { execute, pending, error } = useWriteWithTracking();

  const claimDisputeDefault = async (tradeId: number): Promise<string> =>
    execute({
      method: "claim_dispute_default",
      context: `Trade #${tradeId}`,
      write: (client, network) => claimDisputeDefaultWrite(client, network, BigInt(tradeId)),
    });

  return { claimDisputeDefault, pending, error };
}
