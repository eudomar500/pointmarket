"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTrade } from "@/lib/hooks/useTrade";
import { useResolveTracking } from "@/lib/hooks/useResolveTracking";
import { formatGenBalance } from "@/lib/wallet/format";
import { hasBuyer } from "@/lib/genlayer/escrow";
import StateBadge from "@/components/marketplace/StateBadge";
import TradeTimeline from "@/components/marketplace/TradeTimeline";
import TradeActionsPanel from "@/components/marketplace/TradeActionsPanel";
import TradePartiesCard from "@/components/marketplace/TradePartiesCard";
import DisputePanel from "@/components/marketplace/DisputePanel";
import DeliveryProofBlock from "@/components/marketplace/DeliveryProofBlock";
import TradeMedia from "@/components/media/TradeMedia";
import type { EscrowTrade } from "@/lib/genlayer/types";

const SETTLE_POLL_MS = 30_000;

export default function TradeDetailPage() {
  const params = useParams();
  const id = params?.id;
  const tradeId = typeof id === "string" ? Number(id) : NaN;

  if (!Number.isInteger(tradeId) || tradeId < 0) {
    return <NotFoundView />;
  }

  return <TradeDetailContent tradeId={tradeId} />;
}

function TradeDetailContent({ tradeId }: { tradeId: number }) {
  const tracking = useResolveTracking(tradeId, undefined);
  const waitingOnResolve = tracking.inFlight || tracking.succeededRecently;
  // After a resolve, keep reading get_trade until the settle lands (state 4).
  const { data: trade, isLoading, error } = useTrade(tradeId, {
    pollMs: (t: EscrowTrade | undefined) =>
      waitingOnResolve && t?.state === 3 ? SETTLE_POLL_MS : false,
  });

  if (isLoading) {
    return (
      <main className="pt-24 pb-16 px-6 md:px-12 max-w-6xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-6 w-32 bg-[var(--bg-elevated)] rounded" />
          <div className="h-10 w-2/3 bg-[var(--bg-elevated)] rounded" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 h-64 bg-[var(--bg-elevated)] rounded-xl" />
            <div className="h-64 bg-[var(--bg-elevated)] rounded-xl" />
          </div>
        </div>
      </main>
    );
  }

  if (error || !trade) {
    return <NotFoundView />;
  }

  return (
    <main className="pt-24 pb-16 px-6 md:px-12 max-w-6xl mx-auto">
      <Link
        href="/marketplace"
        className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to marketplace
      </Link>

      <header className="mb-10">
        <div className="text-sm font-mono text-[var(--text-secondary)] mb-2">
          Trade #{trade.id}
        </div>
        <h1 className="text-3xl md:text-4xl font-medium text-[var(--text-primary)] break-words">
          {trade.title}
        </h1>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left column: description, photos, parties, shipping, dispute */}
        <div className="md:col-span-2 space-y-6">
          <div className="p-6 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
            <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-3">
              Description
            </div>
            <p className="text-[var(--text-primary)] whitespace-pre-wrap">
              {trade.description}
            </p>
          </div>

          <TradeMedia trade={trade} />

          <TradePartiesCard seller={trade.seller} buyer={hasBuyer(trade) ? trade.buyer : trade.seller} />

          {trade.shippedAt > 0 ? <ShippingCard trade={trade} /> : null}

          <DisputePanel trade={trade} />

          <DeliveryProofBlock trade={trade} />
        </div>

        {/* Right column: status + timeline */}
        <div className="space-y-6">
          <div className="p-6 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
            <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-3">
              Status
            </div>
            <div className="mb-4">
              <StateBadge state={trade.state} size="md" />
            </div>
            <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-2 mt-6">
              Price
            </div>
            <div className="text-2xl font-medium text-[var(--text-primary)] font-mono">
              {formatGenBalance(trade.price)}
            </div>
          </div>

          <div className="p-6 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
            <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-4">
              Timeline
            </div>
            <TradeTimeline
              trade={{
                state: trade.state,
                seller: trade.seller,
                buyer: trade.buyer,
                wasDisputed: trade.wasDisputed,
                resolvedByDefault: trade.resolvedByDefault,
                buyerWins: trade.buyerWins,
                deliveryProof: Boolean(trade.proofKind),
                verdictTitle: "the Arbiter",
              }}
            />
          </div>

          <TradeActionsPanel trade={trade} />
        </div>
      </div>
    </main>
  );
}

function ShippingCard({ trade }: { trade: EscrowTrade }) {
  return (
    <div className="p-6 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
      <div>
        <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">Carrier</div>
        <div className="text-[var(--text-primary)] break-words">{trade.trackingCarrier}</div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">Tracking</div>
        <div className="text-[var(--text-primary)] font-mono break-all">{trade.trackingNumber}</div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">Carrier domains</div>
        <div className="text-[var(--text-primary)] font-mono break-all">
          {trade.carrierDomains ? trade.carrierDomains.split(",").join(", ") : "None"}
        </div>
      </div>
    </div>
  );
}

function NotFoundView() {
  return (
    <main className="pt-24 pb-16 px-6 md:px-12 max-w-6xl mx-auto text-center">
      <h1 className="text-3xl font-medium text-[var(--text-primary)] mb-3">
        Trade not found
      </h1>
      <p className="text-[var(--text-secondary)] mb-8">
        This trade ID does not exist or has not been deployed.
      </p>
      <Link
        href="/marketplace"
        className="inline-block px-6 py-3 rounded-lg bg-[var(--accent-primary)] text-[var(--bg-deep)] font-medium hover:bg-[var(--accent-dim)] transition-colors"
      >
        Browse marketplace
      </Link>
    </main>
  );
}
