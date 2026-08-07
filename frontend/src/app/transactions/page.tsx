"use client";

import { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  getTransactionsBrowse,
  getTransactionsBrowseMeta,
  getTxnSubscriptions,
} from "@/lib/api";
import type {
  CategorySort,
  ListFilters,
  Transaction,
  TransactionBrowseMeta,
} from "@/lib/types";
import { monthLabel } from "@/components/ledger/format";
import SpendingHero from "@/components/spending/SpendingHero";
import CategoryTable from "@/components/spending/CategoryTable";
import LongTermView from "@/components/spending/LongTermView";
import TransactionList, { EMPTY_FILTERS } from "@/components/spending/TransactionList";
import {
  CommittedVsChosen,
  DataHealthBanner,
  StoryLine,
  TopPurchases,
} from "@/components/spending/SpendingCards";
import {
  buildSpendingModel,
  keyToYearMonth,
  UNCATEGORIZED,
} from "@/components/spending/model";
import { useIsCompact } from "@/components/ledger/useIsCompact";

export default function SpendingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-lg text-cj-text-muted">Loading...</p>
        </div>
      }
    >
      <Spending />
    </Suspense>
  );
}

function Spending() {
  // The overview's category cards deep-link straight into a filtered list.
  const initialCategory = useSearchParams().get("category");

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [meta, setMeta] = useState<TransactionBrowseMeta | null>(null);
  const [committed, setCommitted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [monthKey, setMonthKey] = useState<number | null>(null);
  const [category, setCategory] = useState<string | null>(initialCategory);
  const [sort, setSort] = useState<CategorySort>("amount");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
  const [longOpen, setLongOpen] = useState(false);

  const compact = useIsCompact();

  useEffect(() => {
    Promise.all([getTransactionsBrowseMeta(), getTransactionsBrowse()]).then(([m, txns]) => {
      setMeta(m);
      setTransactions(txns);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const model = useMemo(() => buildSpendingModel(transactions), [transactions]);

  useEffect(() => {
    if (monthKey === null && model.months.length) setMonthKey(model.latestKey);
  }, [model, monthKey]);

  // Committed/recurring detection lives server-side, over the 12 months ending
  // at the shown month — a calendar-year window can't see a monthly bill early
  // in the year, and resets every January (#162).
  const ym = monthKey === null ? null : keyToYearMonth(monthKey);
  const windowYear = ym?.year ?? null;
  // keyToYearMonth is 0-indexed; the API takes 1-12.
  const windowMonth = ym === null ? null : ym.month + 1;
  useEffect(() => {
    if (windowYear === null || windowMonth === null) return;
    getTxnSubscriptions(windowYear, windowMonth)
      .then((subs) => setCommitted(new Set(subs.map((s) => s.name))))
      .catch(() => setCommitted(new Set()));
  }, [windowYear, windowMonth]);

  const goPrev = useCallback(() => setMonthKey((k) => (k === null ? k : k - 1)), []);
  const goNext = useCallback(
    () => setMonthKey((k) => (k === null ? k : Math.min(model.latestKey, k + 1))),
    [model.latestKey]
  );

  if (loading || !meta || monthKey === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-cj-text-muted">Loading...</p>
      </div>
    );
  }

  const month = model.byKey.get(monthKey);
  const monthTxns = month?.txns ?? [];
  const prevTxns = model.byKey.get(monthKey - 1)?.txns ?? [];
  const { year: y, month: m } = keyToYearMonth(monthKey);
  const atLatest = monthKey >= model.latestKey;
  const atEarliest = monthKey <= (model.months[0]?.key ?? monthKey);
  const day = model.coverageDay(monthKey);

  return (
    <div className="fx min-h-screen">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-5 py-5 pb-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-0.5 rounded-[10px] border border-fx-line bg-fx-surface-2 p-0.5">
            <button
              type="button"
              onClick={goPrev}
              disabled={atEarliest}
              aria-label="Previous month"
              className="rounded-lg px-3 py-1.5 text-fx-ink-2 disabled:cursor-default disabled:text-fx-ink-3"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-[112px] text-center text-[13px] font-semibold">
              {monthLabel(y, m)}
            </span>
            <button
              type="button"
              onClick={goNext}
              disabled={atLatest}
              aria-label="Next month"
              className="rounded-lg px-3 py-1.5 text-fx-ink-2 disabled:cursor-default disabled:text-fx-ink-3"
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <span className="text-[11.5px] text-fx-ink-3">
            {atLatest && day < (month?.days ?? 0)
              ? `through day ${day} of ${month?.days}`
              : `full month · ${month?.days ?? 0} days`}
          </span>
          <div className="min-w-[8px] flex-1" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search merchant, category, subcategory…"
            aria-label="Search transactions"
            className={`rounded-[10px] border border-fx-line bg-fx-card-bg px-3 py-[9px] text-[12.5px] text-fx-ink outline-none ${
              compact ? "w-full flex-[1_1_100%]" : "flex-[0_1_260px]"
            }`}
          />
        </div>

        <SpendingHero model={model} monthKey={monthKey} compact={compact} />

        <StoryLine
          model={model}
          monthKey={monthKey}
          transactions={monthTxns}
          committed={committed}
        />

        <DataHealthBanner
          transactions={monthTxns}
          onReview={() => setCategory(UNCATEGORIZED)}
        />

        <div className="flex flex-wrap gap-3">
          <CommittedVsChosen
            transactions={monthTxns}
            committed={committed}
            previousTransactions={prevTxns}
          />
          <TopPurchases transactions={monthTxns} monthKey={monthKey} />
        </div>

        <CategoryTable
          model={model}
          monthKey={monthKey}
          sort={sort}
          onSortChange={setSort}
          selected={category}
          onSelect={setCategory}
          compact={compact}
        />

        <LongTermView
          model={model}
          monthKey={monthKey}
          category={category}
          open={longOpen}
          onToggle={() => setLongOpen((o) => !o)}
        />

        <TransactionList
          transactions={monthTxns}
          monthKey={monthKey}
          meta={meta}
          committed={committed}
          category={category}
          onClearCategory={() => setCategory(null)}
          search={search}
          filters={filters}
          onFiltersChange={setFilters}
          compact={compact}
        />
      </div>
    </div>
  );
}
