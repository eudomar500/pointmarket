"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Archive, ExternalLink } from "lucide-react";
import { DEFAULT_NETWORK, findLegacyMarketplace, type LegacyMarketplace } from "@/lib/genlayer/contracts";
import { useLegacyTrade, type LegacyTradeDetail } from "@/lib/hooks/useLegacyTrade";
import { formatGenBalance } from "@/lib/wallet/format";
import { NETWORKS } from "@/config/networks";
import StateBadge from "@/components/marketplace/StateBadge";
import TradeTimeline from "@/components/marketplace/TradeTimeline";
import TradePartiesCard from "@/components/marketplace/TradePartiesCard";

/**
 * A trade on a pre-v1.5 Marketplace, read only. Nothing on this page
 * writes: those contracts are kept so their trades stay visible.
 */
export default function LegacyTradePage() {
  const params = useParams();
  const sourceKey = typeof params?.source === "string" ? params.source : "";
  const id = typeof params?.id === "string" ? Number(params.id) : NaN;
  const source = findLegacyMarketplace(DEFAULT_NETWORK, sourceKey);

  if (!source || !Number.isInteger(id) || id < 0) {
    return <NotFound />;
  }
  return <LegacyTradeContent source={source} tradeId={id} />;
}

function LegacyTradeContent({ source, tradeId }: { source: LegacyMarketplace; tradeId: number }) {
  const { data: trade, isLoading, error } = useLegacyTrade(source, tradeId);

  if (isLoading) {
    return (
      <main className="pt-24 pb-16 px-6 md:px-12 max-w-6xl mx-auto">
        <div className="animate-pulse h-64 bg-[var(--bg-elevated)] rounded-xl" />
      </main>
    );
  }
  if (error || !trade) return <NotFound />;

  const explorer = NETWORKS[DEFAULT_NETWORK].explorerUrl;

  return (
    <main className="pt-24 pb-16 px-6 md:px-12 max-w-6xl mx-auto">
      <Link
        href="/marketplace"
        className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to marketplace
      </Link>

      <div className="mb-6 p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-start gap-3 text-sm text-[var(--text-secondary)]">
        <Archive size={16} className="mt-0.5 flex-shrink-0" />
        <div>
          Legacy trade on {source.label}, shown read only. New trades run on the v1.5 Escrow.{" "}
          <a
            href={`${explorer}/address/${source.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[var(--accent-primary)] hover:underline"
          >
            Contract <ExternalLink size={12} />
          </a>
        </div>
      </div>

      <header className="mb-10">
        <div className="text-sm font-mono text-[var(--text-secondary)] mb-2">
          {source.label} trade #{trade.id}
        </div>
        <h1 className="text-3xl md:text-4xl font-medium text-[var(--text-primary)] break-words">
          {trade.title}
        </h1>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card label="Description">
            <p className="text-[var(--text-primary)] whitespace-pre-wrap">{trade.description}</p>
          </Card>
          <TradePartiesCard seller={trade.seller} buyer={trade.buyer} />
          {trade.trackingNumber ? (
            <Card label="Shipping">
              <p className="text-sm text-[var(--text-primary)]">
                {trade.trackingCarrier} <span className="font-mono">{trade.trackingNumber}</span>
              </p>
            </Card>
          ) : null}
          {trade.disputed || trade.state === 3 ? <LegacyDispute trade={trade} /> : null}
        </div>

        <div className="space-y-6">
          <Card label="Status">
            <StateBadge state={trade.state} size="md" />
            <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-2 mt-6">Price</div>
            <div className="text-2xl font-medium text-[var(--text-primary)] font-mono">
              {formatGenBalance(trade.price)}
            </div>
          </Card>
          <Card label="Timeline">
            <TradeTimeline
              trade={{
                state: trade.state,
                seller: trade.seller,
                buyer: trade.buyer,
                wasDisputed: trade.disputed,
                resolvedByDefault: trade.resolvedByDefault,
                buyerWins: trade.verdictBuyerWins,
                verdictTitle: `${source.label} (in-contract verdict)`,
              }}
            />
          </Card>
        </div>
      </div>
    </main>
  );
}

function LegacyDispute({ trade }: { trade: LegacyTradeDetail }) {
  return (
    <Card label="Dispute (as recorded by the legacy contract)">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mb-4">
        <div>
          <div className="text-xs text-[var(--text-secondary)]">Buyer bond</div>
          <div className="font-mono">{trade.buyerBond > 0n ? formatGenBalance(trade.buyerBond) : "Not posted"}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-secondary)]">Seller bond</div>
          <div className="font-mono">{trade.sellerBond > 0n ? formatGenBalance(trade.sellerBond) : "Not posted"}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs text-[var(--text-secondary)] mb-1">Buyer evidence</div>
          <p className="whitespace-pre-wrap break-words">{trade.buyerEvidence || "None"}</p>
        </div>
        <div>
          <div className="text-xs text-[var(--text-secondary)] mb-1">Seller evidence</div>
          <p className="whitespace-pre-wrap break-words">{trade.sellerEvidence || "None"}</p>
        </div>
      </div>
      {trade.verdictReasoning ? (
        <div className="mt-4 text-sm">
          <div className="text-xs text-[var(--text-secondary)] mb-1">
            Recorded verdict: {trade.verdictBuyerWins ? "buyer" : "seller"} won
          </div>
          <p className="text-[var(--text-secondary)] whitespace-pre-wrap break-words">{trade.verdictReasoning}</p>
        </div>
      ) : null}
    </Card>
  );
}

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="p-6 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
      <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-3">{label}</div>
      {children}
    </div>
  );
}

function NotFound() {
  return (
    <main className="pt-24 pb-16 px-6 md:px-12 max-w-6xl mx-auto text-center">
      <h1 className="text-3xl font-medium text-[var(--text-primary)] mb-3">Trade not found</h1>
      <p className="text-[var(--text-secondary)] mb-8">This legacy trade does not exist.</p>
      <Link
        href="/marketplace"
        className="inline-block px-6 py-3 rounded-lg bg-[var(--accent-primary)] text-[var(--bg-deep)] font-medium hover:bg-[var(--accent-dim)] transition-colors"
      >
        Browse marketplace
      </Link>
    </main>
  );
}
