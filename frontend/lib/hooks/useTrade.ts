"use client";

import { useQuery } from "@tanstack/react-query";
import { DEFAULT_NETWORK, type ArchivedEscrow } from "@/lib/genlayer/contracts";
import { getEscrowContractInfo, getTrade } from "@/lib/genlayer/reads";
import { createReadClient } from "@/lib/genlayer/client";
import type { EscrowTrade } from "@/lib/genlayer/types";

export type { EscrowTrade };

interface UseTradeOptions {
  /**
   * Refetch interval in ms, or a function of the last data that returns
   * one. Used to keep reading get_trade until a settle lands (state 4).
   */
  pollMs?: number | false | ((trade: EscrowTrade | undefined) => number | false);
}

function interval(opts: UseTradeOptions) {
  const poll = opts.pollMs ?? false;
  return typeof poll === "function"
    ? (query: { state: { data: EscrowTrade | undefined } }) => poll(query.state.data)
    : poll;
}

/** Escrow.get_trade at the latest state (accepted, maybe not final). */
export function useTrade(tradeId: number, opts: UseTradeOptions = {}) {
  return useQuery<EscrowTrade>({
    queryKey: ["escrow", "trade", tradeId],
    queryFn: () => getTrade(createReadClient(DEFAULT_NETWORK), DEFAULT_NETWORK, tradeId),
    staleTime: 30_000,
    refetchInterval: interval(opts),
  });
}

/**
 * Escrow.get_trade at LATEST_FINAL: the view the Arbiter judges. A write
 * that is accepted but not final (a seller response, an unboxing photo)
 * shows in useTrade before it shows here.
 */
export function useFinalTrade(tradeId: number, opts: UseTradeOptions = {}) {
  return useQuery<EscrowTrade>({
    queryKey: ["escrow", "trade-final", tradeId],
    queryFn: () =>
      getTrade(createReadClient(DEFAULT_NETWORK), DEFAULT_NETWORK, tradeId, { final: true }),
    staleTime: 30_000,
    refetchInterval: interval(opts),
  });
}

/**
 * One trade on an archived v1.5 Escrow, read only, plus the arbiter that
 * Escrow was wired to (for the explorer link on a settled dispute).
 */
export function useArchivedTrade(source: ArchivedEscrow | undefined, tradeId: number) {
  return useQuery<{ trade: EscrowTrade; arbiter: string }>({
    queryKey: ["archived-escrow", source?.key ?? "none", "trade", tradeId],
    queryFn: async () => {
      if (!source) throw new Error("Unknown archived Escrow");
      const client = createReadClient(DEFAULT_NETWORK);
      const opts = { escrow: source.address };
      const trade = await getTrade(client, DEFAULT_NETWORK, tradeId, opts);
      const info = await getEscrowContractInfo(client, DEFAULT_NETWORK, opts);
      return { trade, arbiter: info.arbiter };
    },
    enabled: Boolean(source),
    staleTime: 60_000,
  });
}
