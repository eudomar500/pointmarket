"use client";
import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_NETWORK,
  type ArchivedEscrow,
  type LegacyMarketplace,
} from "@/lib/genlayer/contracts";
import {
  getEscrowContractInfo,
  getLegacyListingDetails,
  getLegacyMetrics,
  getLegacyTradeSummary,
  getTrade,
} from "@/lib/genlayer/reads";
import { createReadClient } from "@/lib/genlayer/client";
import { useEscrowInfo } from "./useEscrowInfo";

export type TradeListItem = {
  id: number;
  title: string;
  seller: string;
  buyer: string;
  price: bigint;
  state: number;
  createdAt: number;
  /** Trade page for this row: /trade/<id> or /legacy/<key>/<id>. */
  href: string;
  /** Small read-only source label shown next to the title, if any. */
  sourceLabel?: string;
};

const READ_DELAY_MS = 250;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  attempt = 0,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimit = message.toLowerCase().includes("rate limit");
    if (isRateLimit && attempt < MAX_RETRIES) {
      const backoff = (attempt + 1) * 1000;
      await sleep(backoff);
      return withRateLimitRetry(fn, attempt + 1);
    }
    throw err;
  }
}

/**
 * Sequential reads with a small pause between trades. Bradbury's public
 * RPC throttles concurrent gen_call requests; serializing keeps us within
 * its limits while the marketplace is small. When it grows, this should
 * move to batched reads or an indexer.
 */
async function readSequentially(
  total: number,
  read: (id: number) => Promise<TradeListItem>,
): Promise<TradeListItem[]> {
  const results: TradeListItem[] = [];
  for (let i = 0; i < total; i++) {
    try {
      results.push(await withRateLimitRetry(() => read(i)));
    } catch {
      // After retries, give up on this trade but do not block the others.
    }
    if (i < total - 1) await sleep(READ_DELAY_MS);
  }
  return results;
}

/** Every trade on the v1.5 Escrow, one get_trade per trade. */
export function useAllTrades() {
  const { data: info } = useEscrowInfo();
  const total = info ? Number(info.total_trades) : 0;
  return useQuery({
    queryKey: ["escrow", "all-trades", total],
    queryFn: async (): Promise<TradeListItem[]> => {
      const client = createReadClient(DEFAULT_NETWORK);
      return readSequentially(total, async (id) => {
        const t = await getTrade(client, DEFAULT_NETWORK, id);
        return {
          id,
          title: t.title,
          seller: t.seller,
          buyer: t.buyer,
          price: t.price,
          state: t.state,
          createdAt: t.createdAt,
          href: `/trade/${id}`,
        };
      });
    },
    enabled: total > 0,
    staleTime: 30_000,
  });
}

/** Every trade on one archived v1.5 Escrow, read only, with the Escrow read code. */
export function useArchivedTrades(source: ArchivedEscrow | undefined) {
  return useQuery({
    queryKey: ["archived-escrow", source?.key ?? "none", "all-trades"],
    queryFn: async (): Promise<TradeListItem[]> => {
      if (!source) return [];
      const client = createReadClient(DEFAULT_NETWORK);
      const opts = { escrow: source.address };
      const info = await getEscrowContractInfo(client, DEFAULT_NETWORK, opts);
      return readSequentially(Number(info.total_trades), async (id) => {
        const t = await getTrade(client, DEFAULT_NETWORK, id, opts);
        return {
          id,
          title: t.title,
          seller: t.seller,
          buyer: t.buyer,
          price: t.price,
          state: t.state,
          createdAt: t.createdAt,
          href: `/legacy/${source.key}/${id}`,
          sourceLabel: source.label,
        };
      });
    },
    enabled: Boolean(source),
    staleTime: 60_000,
  });
}

/** Every trade on one legacy v1.4.x Marketplace, read only. */
export function useLegacyTrades(source: LegacyMarketplace | undefined) {
  return useQuery({
    queryKey: ["legacy", source?.key ?? "none", "all-trades"],
    queryFn: async (): Promise<TradeListItem[]> => {
      if (!source) return [];
      const client = createReadClient(DEFAULT_NETWORK);
      const metrics = await getLegacyMetrics(client, source.address);
      const total = Number(metrics.total_trades_created);
      return readSequentially(total, async (id) => {
        const listing = await getLegacyListingDetails(client, source.address, id);
        await sleep(READ_DELAY_MS);
        const summary = await getLegacyTradeSummary(client, source.address, id);
        return {
          id,
          title: listing.title,
          seller: summary.seller,
          buyer: summary.buyer,
          price: BigInt(summary.price),
          state: Number(summary.state),
          createdAt: Number(summary.created_at),
          href: `/legacy/${source.key}/${id}`,
        };
      });
    },
    enabled: Boolean(source),
    staleTime: 60_000,
  });
}
