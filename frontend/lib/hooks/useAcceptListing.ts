"use client";

import { useWriteWithTracking } from "@/lib/tx/useWriteWithTracking";
import { acceptListing as acceptListingWrite } from "@/lib/genlayer/writes";

/**
 * Escrow accept_listing, payable. The contract requires LISTING_OPEN, a
 * sender other than the seller, an unpaused Escrow and a value equal to
 * the price. A revert on Bradbury keeps the value, so the write reads the
 * trade again right before signing and refuses (nothing is sent) unless
 * all of that holds and the price on chain equals the price shown.
 */
export function useAcceptListing() {
  const { execute, pending, error } = useWriteWithTracking();

  const acceptListing = async (tradeId: number, expectedPrice: bigint): Promise<string> =>
    execute({
      method: "accept_listing",
      context: `Trade #${tradeId}`,
      write: (client, network, sender) =>
        acceptListingWrite(client, network, { tradeId: BigInt(tradeId), sender, expectedPrice }),
    });

  return { acceptListing, pending, error };
}
