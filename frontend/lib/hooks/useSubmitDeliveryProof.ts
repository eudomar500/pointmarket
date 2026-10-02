"use client";

import { useWriteWithTracking } from "@/lib/tx/useWriteWithTracking";
import { submitDeliveryProof as submitDeliveryProofWrite } from "@/lib/genlayer/writes";

/**
 * Escrow submit_delivery_proof. Seller only, in SHIPPED or DISPUTED, once.
 * The Escrow reads the Lacre record at LATEST_FINAL and accepts it only if
 * it is valid, aligned, signed by one of the trade's carrier domains with a
 * key of at least 1024 bits, signed after paid_at, and the signed email has
 * not served another trade. Otherwise `[EXPECTED] no accepted attestation`.
 */
export function useSubmitDeliveryProof() {
  const { execute, pending, error } = useWriteWithTracking();

  const submitDeliveryProof = async (tradeId: number, recordId: string): Promise<string> =>
    execute({
      method: "submit_delivery_proof",
      context: `Trade #${tradeId}`,
      write: (client, network) =>
        submitDeliveryProofWrite(client, network, { tradeId: BigInt(tradeId), recordId }),
    });

  return { submitDeliveryProof, pending, error };
}
