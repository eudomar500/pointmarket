"use client";

import { useWriteWithTracking } from "@/lib/tx/useWriteWithTracking";
import { openDispute as openDisputeWrite } from "@/lib/genlayer/writes";

/**
 * Escrow open_dispute, payable. Buyer only, on a SHIPPED trade, before
 * claim_at, unpaused, value exactly BUYER_BOND (10^16 wei), claim kind 1
 * to 3, statement 1 to 2,000 characters, CID empty or a raw CIDv1 (it
 * becomes the unboxing photo). The write re-reads the trade and refuses
 * before signing if any of that fails, because a revert keeps the bond.
 */
export function useOpenDispute() {
  const { execute, pending, error } = useWriteWithTracking();

  const openDispute = async (args: {
    tradeId: number;
    claimKind: number;
    statement: string;
    cid: string;
  }): Promise<string> =>
    execute({
      method: "open_dispute",
      context: `Trade #${args.tradeId}`,
      write: (client, network, sender) =>
        openDisputeWrite(client, network, { ...args, tradeId: BigInt(args.tradeId), sender }),
    });

  return { openDispute, pending, error };
}
