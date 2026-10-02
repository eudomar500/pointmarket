"use client";

import { useWriteWithTracking } from "@/lib/tx/useWriteWithTracking";
import { respondToDispute as respondToDisputeWrite } from "@/lib/genlayer/writes";

/**
 * Escrow respond_to_dispute, payable. Seller only, on a DISPUTED trade not
 * yet answered, before response_until, value exactly price * 5%. It records
 * the statement, the optional response photo and the bond; it does not
 * resolve anything. The verdict comes from Arbiter.resolve, which anyone
 * can call once this response is final. Pre-checked before signing.
 */
export function useRespondToDispute() {
  const { execute, pending, error } = useWriteWithTracking();

  const respondToDispute = async (args: {
    tradeId: number;
    statement: string;
    cid: string;
  }): Promise<string> =>
    execute({
      method: "respond_to_dispute",
      context: `Trade #${args.tradeId}`,
      write: (client, network, sender) =>
        respondToDisputeWrite(client, network, { ...args, tradeId: BigInt(args.tradeId), sender }),
    });

  return { respondToDispute, pending, error };
}
