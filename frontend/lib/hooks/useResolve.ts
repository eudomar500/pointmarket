"use client";

import { useWriteWithTracking } from "@/lib/tx/useWriteWithTracking";
import { resolve as resolveWrite } from "@/lib/genlayer/writes";

/**
 * Arbiter.resolve(trade_id). Anyone may call it. The Arbiter reads the
 * trade at LATEST_FINAL, applies the burden rules and, when they do not
 * decide, runs the one-image jury; then it emits Escrow.settle on
 * finalization. Not payable.
 */
export function useResolve() {
  const { execute, pending, error } = useWriteWithTracking();

  const resolve = async (tradeId: number): Promise<string> =>
    execute({
      method: "resolve",
      context: `Trade #${tradeId}`,
      write: (client, network) => resolveWrite(client, network, BigInt(tradeId)),
    });

  return { resolve, pending, error };
}
