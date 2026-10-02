"use client";

import { useState } from "react";
import { ExternalLink, Gavel, Loader2 } from "lucide-react";
import { useWalletStore } from "@/lib/wallet/store";
import { useResolve } from "@/lib/hooks/useResolve";
import { useFinalTrade } from "@/lib/hooks/useTrade";
import { useArbiterInfo } from "@/lib/hooks/useEscrowInfo";
import { useResolveTracking } from "@/lib/hooks/useResolveTracking";
import { nowSeconds, resolveReadiness } from "@/lib/genlayer/escrow";
import { DEFAULT_NETWORK } from "@/lib/genlayer/contracts";
import { NETWORKS } from "@/config/networks";
import { formatDateTime } from "@/lib/utils/time";
import type { EscrowTrade } from "@/lib/genlayer/types";

const POLL_MS = 30_000;

function txUrl(hash: string): string {
  return `${NETWORKS[DEFAULT_NETWORK].explorerUrl}/tx/${hash}`;
}

/**
 * The Resolve button and what happened to the last resolve.
 *
 * Anyone may resolve. Readiness is computed from the LATEST_FINAL view of
 * the trade, the one the Arbiter reads, so a seller response that is
 * accepted but not final does not unlock it early. After a resolve, the
 * receipt's consensus result decides what we say: an agreement means the
 * verdict is in and the payout follows when the settle finalizes; a
 * timeout (VALIDATORS_TIMEOUT or LEADER_TIMEOUT, as a status or as the
 * result of a FINALIZED round) means nothing was decided and resolve can
 * be sent again.
 */
export default function ResolvePanel({ trade }: { trade: EscrowTrade }) {
  const { address, status } = useWalletStore();
  const tracking = useResolveTracking(trade.id, trade.state);
  const waiting = tracking.inFlight || tracking.awaitingSettle;
  const { data: finalTrade, isLoading: finalLoading } = useFinalTrade(trade.id, {
    pollMs: waiting ? POLL_MS : false,
  });
  const { data: arbiter } = useArbiterInfo();
  const { resolve, pending } = useResolve();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const connected = status === "connected" && Boolean(address);
  const readiness = finalTrade
    ? resolveReadiness(finalTrade, nowSeconds(), Boolean(arbiter?.paused), formatDateTime)
    : null;
  const responsePendingFinality = Boolean(finalTrade && trade.responded && !finalTrade.responded);
  const latest = tracking.latest;

  let blockReason: string | null = null;
  if (!connected) blockReason = "Connect a wallet to resolve. Anyone can.";
  else if (tracking.inFlight) blockReason = "A resolve for this trade is in progress.";
  else if (tracking.awaitingSettle) blockReason = "Waiting for the payout to finalize.";
  else if (responsePendingFinality)
    blockReason = "The seller's response is accepted but not final yet (about 35 minutes). The Arbiter only reads final state.";
  else if (finalLoading || !readiness) blockReason = "Reading the final state of the trade...";
  else if (!readiness.ready) blockReason = readiness.reason;

  const canResolve = blockReason === null && !pending;
  const retry = tracking.failed || (tracking.succeeded && !tracking.awaitingSettle);

  const handleResolve = async () => {
    setErrorMsg(null);
    try {
      await resolve(trade.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="p-4 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-3">
      <div className="flex items-center gap-2">
        <Gavel size={14} className="text-[var(--text-secondary)]" />
        <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">Resolve</div>
      </div>

      {latest && tracking.inFlight ? (
        <p className="text-sm text-[var(--text-secondary)]">
          Resolve submitted. The verdict is reached in minutes and finalizes in about 35; this page
          follows it.{" "}
          <a href={txUrl(latest.txHash)} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-primary)] hover:underline">
            Resolve transaction
          </a>
        </p>
      ) : null}

      {latest && tracking.awaitingSettle ? (
        <p className="text-sm text-[var(--text-secondary)]">
          The verdict is final on the Arbiter
          {latest.resultName ? ` (consensus ${latest.resultName})` : ""}. Payment arrives when the
          Escrow&apos;s settle finalizes, about 30 to 40 minutes after the verdict. This page checks
          the trade every 30 seconds until it is completed.{" "}
          <a href={txUrl(latest.txHash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-primary)] hover:underline">
            Resolve transaction <ExternalLink size={12} />
          </a>
        </p>
      ) : null}

      {latest && tracking.succeeded && !tracking.awaitingSettle && trade.state === 3 ? (
        <p className="text-sm text-[var(--warning)]">
          The last resolve finalized over an hour ago and the trade is still disputed, so its settle
          did not land. Resolve again.
        </p>
      ) : null}

      {latest && tracking.failed ? (
        <div className="p-3 rounded-md bg-[var(--warning)]/10 border border-[var(--warning)]/30 text-sm text-[var(--text-primary)]">
          {latest.retryable
            ? "The last resolve did not reach a verdict, so nothing was decided and no payment was sent. Retry resolve."
            : "The Arbiter refused the last resolve; nothing was decided. A photo gateway may have been down or a window was still open. Retry once the reason below clears."}
          {latest.failureReason ? (
            <div className="mt-1 text-xs text-[var(--text-secondary)]">{latest.failureReason}</div>
          ) : null}
          <a href={txUrl(latest.txHash)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline">
            Last resolve transaction <ExternalLink size={11} />
          </a>
        </div>
      ) : null}

      <button
        onClick={() => void handleResolve()}
        disabled={!canResolve}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--accent-primary)] text-[var(--bg-deep)] font-medium hover:bg-[var(--accent-dim)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? <Loader2 size={16} className="animate-spin" /> : null}
        {pending ? "Submitting..." : retry ? "Retry resolve" : "Resolve"}
      </button>
      <p className="text-xs text-[var(--text-secondary)]">
        {blockReason ?? readiness?.reason ?? ""}
      </p>

      {errorMsg ? (
        <div className="p-2 rounded-md bg-red-500/10 border border-red-500/30 text-xs text-red-400">{errorMsg}</div>
      ) : null}
    </div>
  );
}
