"use client";

import { useState, useMemo, type ReactNode } from "react";
import { useAllTrades, useArchivedTrades, useLegacyTrades } from "@/lib/hooks/useAllTrades";
import { archivedEscrows, DEFAULT_NETWORK, legacyMarketplaces } from "@/lib/genlayer/contracts";
import TradeTable from "@/components/marketplace/TradeTable";
import TradeFilters from "@/components/marketplace/TradeFilters";

import CreateListingButton from "@/components/marketplace/CreateListingButton";

const PAGE_SIZE = 25;
const CURRENT = "current";

export default function MarketplacePage() {
  const legacySources = legacyMarketplaces(DEFAULT_NETWORK);
  const archivedSources = archivedEscrows(DEFAULT_NETWORK);
  const readOnlySources = [...archivedSources, ...legacySources];
  const [view, setView] = useState<string>(CURRENT);
  const legacySource = legacySources.find((s) => s.key === view);
  const archivedSource = archivedSources.find((s) => s.key === view);

  const current = useAllTrades();
  const legacy = useLegacyTrades(legacySource);
  const archived = useArchivedTrades(archivedSource);
  const { data: trades = [], isLoading } = archivedSource ? archived : legacySource ? legacy : current;

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<number | null>(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    return trades.filter((trade) => {
      if (stateFilter !== null && trade.state !== stateFilter) return false;
      if (search && !trade.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [trades, search, stateFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const selectView = (next: string) => {
    setView(next);
    setPage(0);
  };

  return (
    <main className="pt-24 pb-16 px-6 md:px-12 max-w-7xl mx-auto">
      <header className="mb-10 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-4xl md:text-5xl font-medium text-[var(--text-primary)] mb-3">
            Marketplace
          </h1>
          <p className="text-[var(--text-secondary)] max-w-2xl">
            Trustless P2P trades on GenLayer. Funds sit in escrow on-chain; disputes are settled by burden rules and a validator jury that checks anchored photos.
          </p>
        </div>
        <div className="flex-shrink-0">
          <CreateListingButton />
        </div>
      </header>

      {readOnlySources.length > 0 ? (
        <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
          <ViewTab active={view === CURRENT} onClick={() => selectView(CURRENT)}>
            Current trades
          </ViewTab>
          {readOnlySources.map((source) => (
            <ViewTab key={source.key} active={view === source.key} onClick={() => selectView(source.key)}>
              {source.label} (read only)
            </ViewTab>
          ))}
        </div>
      ) : null}

      <TradeFilters
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(0); }}
        stateFilter={stateFilter}
        onStateFilterChange={(v) => { setStateFilter(v); setPage(0); }}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        resultsCount={filtered.length}
      />

      <TradeTable trades={paginated} isLoading={isLoading} />
    </main>
  );
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg border transition-colors ${active ? "border-[var(--accent-primary)] text-[var(--text-primary)] bg-[var(--bg-elevated)]" : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
    >
      {children}
    </button>
  );
}
