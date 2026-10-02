"use client";

import { useWriteWithTracking } from "@/lib/tx/useWriteWithTracking";
import { cancelListing as cancelListingWrite } from "@/lib/genlayer/writes";

/**
 * Escrow cancel_listing. Seller only, while the listing is LISTING_OPEN;
 * moves it to CANCELLED. Refused while the Escrow is paused.
 */
export function useCancelListing() {
  const { execute, pending, error } = useWriteWithTracking();

  const cancelListing = async (tradeId: number): Promise<string> =>
    execute({
      method: "cancel_listing",
      context: `Trade #${tradeId}`,
      write: (client, network) => cancelListingWrite(client, network, BigInt(tradeId)),
    });

  return { cancelListing, pending, error };
}
