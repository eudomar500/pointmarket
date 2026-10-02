"use client";

import { useWriteWithTracking } from "@/lib/tx/useWriteWithTracking";
import { markShipped as markShippedWrite } from "@/lib/genlayer/writes";

/**
 * Escrow mark_shipped. Seller only, on a PAID trade, refused while paused.
 * Tracking number 4 to 100 characters and carrier 1 to 50 (unchecked
 * strings, as in v1.4.7); up to 3 carrier domains from the Escrow's list,
 * which a Lacre delivery proof must later match; an optional packing photo
 * CID, which can only be set here.
 */
export function useMarkShipped() {
  const { execute, pending, error } = useWriteWithTracking();

  const markShipped = async (args: {
    tradeId: number;
    trackingNumber: string;
    trackingCarrier: string;
    carrierDomains: string[];
    packingMediaCid: string;
  }): Promise<string> =>
    execute({
      method: "mark_shipped",
      context: `Trade #${args.tradeId}`,
      write: (client, network) =>
        markShippedWrite(client, network, { ...args, tradeId: BigInt(args.tradeId) }),
    });

  return { markShipped, pending, error };
}
