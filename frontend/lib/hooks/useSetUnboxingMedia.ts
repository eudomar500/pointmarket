"use client";

import { useWriteWithTracking } from "@/lib/tx/useWriteWithTracking";
import { setUnboxingMedia as setUnboxingMediaWrite } from "@/lib/genlayer/writes";

/**
 * Escrow set_unboxing_media. Buyer only, once, within UNBOXING_WINDOW of
 * disputed_at (on a DISPUTED trade) or of delivered_at (on a COMPLETED
 * trade that was never disputed, where it only feeds reputation).
 */
export function useSetUnboxingMedia() {
  const { execute, pending, error } = useWriteWithTracking();

  const setUnboxingMedia = async (tradeId: number, cid: string): Promise<string> =>
    execute({
      method: "set_unboxing_media",
      context: `Trade #${tradeId}`,
      write: (client, network) =>
        setUnboxingMediaWrite(client, network, { tradeId: BigInt(tradeId), cid }),
    });

  return { setUnboxingMedia, pending, error };
}
