"use client";

import { useMemo } from "react";
import { useTxStore } from "@/lib/tx/store";
import type { PendingTx } from "@/lib/tx/types";

/**
 * After the verdict finalizes on the Arbiter, the payout needs one more
 * finalization on the Escrow (the settle message, about 30 to 40 minutes).
 * Past this grace period with the trade still DISPUTED, the settle did not
 * land and resolve can be sent again.
 */
export const SETTLE_GRACE_MS = 60 * 60 * 1000;

export interface ResolveTracking {
  /** Newest resolve sent from this browser for the trade, if any. */
  latest: PendingTx | null;
  inFlight: boolean;
  succeeded: boolean;
  failed: boolean;
  /** Succeeded less than SETTLE_GRACE_MS ago, whatever the trade state. */
  succeededRecently: boolean;
  /** Verdict final, settle not seen yet, still inside the grace period. */
  awaitingSettle: boolean;
}

/**
 * Follows the resolve transactions this browser sent for one trade. The
 * poller fills in the consensus result, so `succeeded` means FINALIZED
 * with an agreement and a clean return, and a timeout of any kind (status
 * or result) is `failed`.
 */
export function useResolveTracking(tradeId: number, tradeState: number | undefined): ResolveTracking {
  const txs = useTxStore((s) => s.txs);
  return useMemo(() => {
    const context = `Trade #${tradeId}`;
    const latest =
      txs
        .filter((t) => t.method === "resolve" && t.context === context)
        .sort((a, b) => b.submittedAt - a.submittedAt)[0] ?? null;
    const inFlight = Boolean(latest && (latest.uiState === "submitted" || latest.uiState === "accepted"));
    const succeeded = latest?.uiState === "finalized";
    const failed = latest?.uiState === "failed";
    const decidedAt = latest?.decidedAt ?? latest?.lastPolledAt ?? 0;
    const succeededRecently = succeeded && Date.now() - decidedAt < SETTLE_GRACE_MS;
    const awaitingSettle = succeededRecently && tradeState === 3;
    return { latest, inFlight, succeeded, failed, succeededRecently, awaitingSettle };
  }, [txs, tradeId, tradeState]);
}
