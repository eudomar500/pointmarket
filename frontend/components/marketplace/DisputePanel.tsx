"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, FileText, Scale } from "lucide-react";
import { formatGenBalance } from "@/lib/wallet/format";
import { formatDateTime } from "@/lib/utils/time";
import { useResolveTracking } from "@/lib/hooks/useResolveTracking";
import { BPS, PENALTY_BPS, RULE_TEXT, ruleForVerdictHash } from "@/lib/genlayer/escrow";
import { arbiterAddress, DEFAULT_NETWORK } from "@/lib/genlayer/contracts";
import { NETWORKS } from "@/config/networks";
import { ipfsUrl } from "@/lib/media/cid";
import {
  CLAIM_KIND_LABELS,
  TradeState,
  type ClaimKindValue,
  type EscrowTrade,
} from "@/lib/genlayer/types";
import ResolvePanel from "./ResolvePanel";

interface DisputePanelProps {
  trade: EscrowTrade;
  /**
   * Archived Escrow: no Resolve button, no resolve tracking (it is keyed by
   * trade id on the live Escrow), and the Arbiter link goes to `arbiter`.
   */
  readOnly?: boolean;
  arbiter?: string;
}

function windowText(until: number): string {
  if (!until) return "--";
  const open = Date.now() / 1000 < until;
  return `${open ? "Open until" : "Closed"} ${formatDateTime(until)}`;
}

/**
 * Everything about a dispute on a v1.5 trade: the claim, both statements
 * and bonds, the response and unboxing windows, the Resolve button while
 * it is open, and the outcome once the Escrow has paid out.
 */
export default function DisputePanel({ trade, readOnly, arbiter }: DisputePanelProps) {
  const tracking = useResolveTracking(trade.id, trade.state);
  const isOpen = trade.state === TradeState.DISPUTED;
  const settled = trade.wasDisputed && !isOpen;

  const { data: rule } = useQuery({
    queryKey: ["verdict-rule", trade.verdictHash],
    queryFn: () => ruleForVerdictHash(trade.verdictHash),
    enabled: Boolean(trade.verdictHash),
    staleTime: Infinity,
  });

  if (!trade.wasDisputed && !isOpen) {
    return null;
  }

  const claimLabel = CLAIM_KIND_LABELS[trade.claimKind as ClaimKindValue] ?? `Kind ${trade.claimKind}`;
  const explorer = NETWORKS[DEFAULT_NETWORK].explorerUrl;
  const resolveTx = !readOnly && tracking.succeeded ? tracking.latest?.txHash : undefined;
  const arbiterLink = readOnly ? arbiter : arbiterAddress(DEFAULT_NETWORK);

  return (
    <div className="p-6 rounded-xl bg-[var(--warning)]/5 border border-[var(--warning)]/20 space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--warning)]/10 flex items-center justify-center">
          <Scale size={18} className="text-[var(--warning)]" />
        </div>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wider text-[var(--warning)] mb-1">Dispute</div>
          <div className="text-sm text-[var(--text-primary)]">
            Buyer claims <strong>{claimLabel.toLowerCase()}</strong>, opened{" "}
            {formatDateTime(trade.disputedAt)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Fact label="Buyer bond" value={trade.buyerBond > 0n ? formatGenBalance(trade.buyerBond) : "Not posted"} />
        <Fact label="Seller bond" value={trade.sellerBond > 0n ? formatGenBalance(trade.sellerBond) : "Not posted"} />
        <Fact label="Seller responded" value={trade.responded ? "Yes" : "No"} />
        <Fact label="Response window" value={trade.responded ? "Answered" : windowText(trade.responseUntil)} />
        <Fact
          label="Unboxing window"
          value={trade.unboxingMediaCid ? "Photo anchored" : windowText(trade.unboxingUntil)}
        />
        <Fact label="Delivery proof" value={trade.proofKind ? "Accepted" : "None"} />
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-[var(--text-secondary)]" />
          <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">Statements</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Statement title="Buyer" text={trade.buyerEvidence} />
          <Statement
            title="Seller"
            text={trade.sellerEvidence}
            cid={trade.sellerResponseCid}
            emptyText={trade.responded ? "" : "No response yet"}
          />
        </div>
      </div>

      {isOpen && !readOnly ? <ResolvePanel trade={trade} /> : null}

      {settled ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-[var(--text-secondary)]" />
            <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">Outcome</div>
          </div>
          <div className="p-4 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-2 text-sm">
            <Outcome trade={trade} rule={rule ?? null} />
            {trade.verdictHash ? (
              <div className="text-xs text-[var(--text-secondary)] break-all">
                verdict_hash <span className="font-mono">{trade.verdictHash}</span>
              </div>
            ) : null}
            {trade.verdictHash ? (
              resolveTx ? (
                <a
                  href={`${explorer}/tx/${resolveTx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline"
                >
                  Resolve transaction <ExternalLink size={11} />
                </a>
              ) : arbiterLink ? (
                <a
                  href={`${explorer}/address/${arbiterLink}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline"
                >
                  Resolve transactions on the Arbiter <ExternalLink size={11} />
                </a>
              ) : null
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Outcome({ trade, rule }: { trade: EscrowTrade; rule: string | null }) {
  const bonds = trade.buyerBond + trade.sellerBond;
  if (trade.state === TradeState.REFUNDED) {
    return (
      <p className="text-[var(--text-primary)]">
        Closed without a verdict: the price was split 50/50 and each bond went back to its poster.
      </p>
    );
  }
  if (trade.resolvedByDefault) {
    const penalty = (trade.buyerBond * PENALTY_BPS) / BPS;
    return (
      <p className="text-[var(--text-primary)]">
        Winner: <strong className="text-[var(--accent-primary)]">Buyer</strong>, by default judgment.
        The seller did not respond in time. Paid to the buyer:{" "}
        {formatGenBalance(trade.price + trade.buyerBond - penalty)}.
      </p>
    );
  }
  const paid = trade.buyerWins ? trade.price + bonds : trade.price - trade.feeAmount + bonds;
  return (
    <>
      <p className="text-[var(--text-primary)]">
        Winner: <strong className={trade.buyerWins ? "text-[var(--accent-primary)]" : ""}>
          {trade.buyerWins ? "Buyer" : "Seller"}
        </strong>
        . Paid to the {trade.buyerWins ? "buyer" : "seller"}: {formatGenBalance(paid)}
        {trade.buyerWins ? " (price and both bonds)." : " (price minus fee, plus both bonds)."}
      </p>
      <p className="text-[var(--text-secondary)]">
        {rule
          ? `Decided by rule, without the jury. ${RULE_TEXT[rule]}`
          : "Decided by the jury. Its reasoning is in the resolve receipt; its sha256 is the verdict_hash below."}
      </p>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
      <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">{label}</div>
      <div className="text-sm font-medium text-[var(--text-primary)] font-mono">{value}</div>
    </div>
  );
}

function Statement({
  title,
  text,
  cid,
  emptyText = "No statement",
}: {
  title: string;
  text: string;
  cid?: string;
  emptyText?: string;
}) {
  return (
    <div className="p-4 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
      <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-2">{title}</div>
      {text ? (
        <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words">{text}</p>
      ) : (
        <p className="text-sm text-[var(--text-tertiary)] italic">{emptyText}</p>
      )}
      {cid ? (
        <a
          href={ipfsUrl(cid)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline"
        >
          Response photo <ExternalLink size={11} />
        </a>
      ) : null}
    </div>
  );
}
