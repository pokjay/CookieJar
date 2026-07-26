"use client";

import { useMemo, useState, useEffect } from "react";
import * as Slider from "@radix-ui/react-slider";
import { Card, StatTile } from "@/components/ledger/ui";
import { categoryColor, dayLabel, nis } from "@/components/ledger/format";
import type { Transaction, TransactionBrowseMeta } from "@/lib/types";
import { categoryOf, keyToYearMonth } from "./model";

const PAGE = 20;

export interface ListFilters {
  person: string;
  account: string;
  subcategory: string;
  type: "all" | "committed" | "oneoff";
  minAmount: number;
}

export const EMPTY_FILTERS: ListFilters = {
  person: "all",
  account: "all",
  subcategory: "all",
  type: "all",
  minAmount: 0,
};

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 basis-[148px] flex-col gap-[7px]">
      <span className="font-fx-mono text-[9.5px] font-medium leading-none tracking-[0.08em] text-fx-ink-3">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer appearance-none rounded-[9px] border border-fx-line bg-fx-card-bg py-[9px] pl-2.5 pr-[30px] text-[12.5px] text-fx-ink outline-none"
        style={{
          backgroundImage:
            "linear-gradient(45deg,transparent 50%,var(--fx-ink-3) 50%),linear-gradient(135deg,var(--fx-ink-3) 50%,transparent 50%)",
          backgroundPosition: "calc(100% - 15px) 52%,calc(100% - 10px) 52%",
          backgroundSize: "5px 5px",
          backgroundRepeat: "no-repeat",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function TransactionList({
  transactions,
  monthKey: key,
  meta,
  committed,
  category,
  onClearCategory,
  search,
  filters,
  onFiltersChange,
  compact,
}: {
  transactions: Transaction[];
  monthKey: number;
  meta: TransactionBrowseMeta;
  committed: Set<string>;
  category: string | null;
  onClearCategory: () => void;
  search: string;
  filters: ListFilters;
  onFiltersChange: (filters: ListFilters) => void;
  compact: boolean;
}) {
  const [limit, setLimit] = useState(PAGE);
  const { year, month } = keyToYearMonth(key);

  const searchMatched = useMemo(() => {
    let list = transactions;
    if (category) list = list.filter((t) => categoryOf(t) === category);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        `${t.processed_description} ${t.category ?? ""} ${t.subcategory ?? ""}`
          .toLowerCase()
          .includes(q)
      );
    }
    return list;
  }, [transactions, category, search]);

  // Subcategory options follow whatever the category/search has already narrowed to.
  const subcategoryOptions = useMemo(() => {
    const subs = [...new Set(searchMatched.map((t) => t.subcategory).filter(Boolean))] as string[];
    return subs.sort();
  }, [searchMatched]);

  const maxAmount = useMemo(
    () => Math.max(200, Math.ceil(Math.max(...transactions.map((t) => t.charged_amount), 0) / 100) * 100),
    [transactions]
  );

  const filtered = useMemo(() => {
    let list = searchMatched;
    if (filters.person !== "all") list = list.filter((t) => t.person === filters.person);
    if (filters.account !== "all") list = list.filter((t) => t.account === filters.account);
    if (filters.subcategory !== "all" && subcategoryOptions.includes(filters.subcategory)) {
      list = list.filter((t) => t.subcategory === filters.subcategory);
    }
    if (filters.type !== "all") {
      const wantCommitted = filters.type === "committed";
      list = list.filter((t) => committed.has(t.processed_description) === wantCommitted);
    }
    if (filters.minAmount > 0) list = list.filter((t) => t.charged_amount >= filters.minAmount);
    return list;
  }, [searchMatched, filters, subcategoryOptions, committed]);

  useEffect(() => {
    setLimit(PAGE);
  }, [key, category, search, filters]);

  const shown = filtered.slice(0, limit);
  const total = filtered.reduce((s, t) => s + t.charged_amount, 0);

  const groups = useMemo(() => {
    const out: { day: number; label: string; items: Transaction[]; total: number }[] = [];
    for (const t of shown) {
      const day = Number(t.activity_date.slice(8, 10));
      let group = out[out.length - 1];
      if (!group || group.day !== day) {
        group = { day, label: dayLabel(year, month, day), items: [], total: 0 };
        out.push(group);
      }
      group.items.push(t);
      group.total += t.charged_amount;
    }
    return out;
  }, [shown, year, month]);

  const activeFilterCount =
    (filters.person !== "all" ? 1 : 0) +
    (filters.account !== "all" ? 1 : 0) +
    (filters.subcategory !== "all" ? 1 : 0) +
    (filters.type !== "all" ? 1 : 0) +
    (filters.minAmount > 0 ? 1 : 0);

  const set = <K extends keyof ListFilters>(k: K, v: ListFilters[K]) =>
    onFiltersChange({ ...filters, [k]: v });

  return (
    <Card>
      <div className="mb-[13px] flex flex-wrap items-center gap-2.5">
        <span className="text-[12.5px] font-semibold">{category ?? "All transactions"}</span>
        <span className="text-[11.5px] text-fx-ink-3">
          {shown.length} of {filtered.length}
          {search.trim() ? " matching" : ""}
        </span>
        <div className="min-w-[8px] flex-1" />
        {(category || activeFilterCount > 0) && (
          <button
            type="button"
            onClick={() => {
              onClearCategory();
              onFiltersChange(EMPTY_FILTERS);
            }}
            className="rounded-full border border-fx-accent bg-fx-accent-soft px-[11px] py-1.5 text-[11.5px] text-fx-accent"
          >
            {category ??
              `${activeFilterCount} ${activeFilterCount === 1 ? "filter" : "filters"}`}{" "}
            ✕
          </button>
        )}
      </div>

      <div className="mb-[15px] flex flex-wrap gap-[11px] border-b border-fx-line pb-[15px]">
        <Select
          label="PERSON"
          value={filters.person}
          onChange={(v) => set("person", v)}
          options={[
            { value: "all", label: "Everyone" },
            ...meta.persons.map((p) => ({ value: p, label: p })),
          ]}
        />
        <Select
          label="ACCOUNT"
          value={filters.account}
          onChange={(v) => set("account", v)}
          options={[
            { value: "all", label: "All accounts" },
            ...meta.accounts.map((a) => ({ value: a, label: a })),
          ]}
        />
        <Select
          label="SUBCATEGORY"
          value={filters.subcategory}
          onChange={(v) => set("subcategory", v)}
          options={[
            { value: "all", label: "All subcategories" },
            ...subcategoryOptions.map((s) => ({ value: s, label: s })),
          ]}
        />
        <Select
          label="TYPE"
          value={filters.type}
          onChange={(v) => set("type", v as ListFilters["type"])}
          options={[
            { value: "all", label: "Everything" },
            { value: "committed", label: "Committed only" },
            { value: "oneoff", label: "One-off only" },
          ]}
        />
        <label className="flex min-w-0 flex-1 basis-[168px] flex-col gap-[7px]">
          <span className="font-fx-mono text-[9.5px] font-medium leading-none tracking-[0.08em] text-fx-ink-3">
            MIN AMOUNT · {filters.minAmount > 0 ? nis(filters.minAmount) : "ANY"}
          </span>
          <Slider.Root
            className="relative flex h-8 w-full touch-none select-none items-center"
            min={0}
            max={maxAmount}
            step={10}
            value={[filters.minAmount]}
            onValueChange={(v) => set("minAmount", v[0])}
          >
            <Slider.Track className="relative h-1 grow rounded-full bg-fx-surface-2">
              <Slider.Range className="absolute h-full rounded-full bg-fx-accent" />
            </Slider.Track>
            <Slider.Thumb
              aria-label="Minimum amount"
              className="block h-4 w-4 cursor-pointer rounded-full bg-fx-accent shadow-md focus:outline-none focus:ring-2 focus:ring-fx-accent"
            />
          </Slider.Root>
        </label>
      </div>

      <div className="mb-4 flex flex-wrap gap-[11px]">
        <StatTile label="Transactions" value={String(filtered.length)} />
        <StatTile label="Total" value={nis(total)} />
        <StatTile label="Average" value={nis(total / (filtered.length || 1))} />
      </div>

      <div className="flex flex-col gap-[17px]">
        {groups.map((g) => (
          <div key={g.day}>
            <div className="flex items-center justify-between gap-2.5 border-b border-fx-line pb-2">
              <span className="font-fx-mono text-[10.5px] font-medium leading-none tracking-[0.05em] text-fx-ink-3">
                {g.label}
              </span>
              <span className="text-[11.5px] text-fx-ink-3">{nis(g.total)}</span>
            </div>
            {g.items.map((t) => {
              const uncategorized = !t.category;
              return (
                <div
                  key={t.unique_id}
                  className="flex items-center gap-[11px] border-b border-fx-line-2 px-0.5 py-2.5"
                >
                  <span
                    className="flex h-[31px] w-[31px] flex-none items-center justify-center rounded-[10px] bg-fx-surface-2 text-[12.5px] font-semibold"
                    style={{ color: categoryColor(t.category) }}
                  >
                    {t.processed_description.charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[13px] font-medium ${
                        uncategorized ? "italic text-fx-ink-2" : "text-fx-ink"
                      }`}
                    >
                      {t.processed_description}
                    </span>
                    <span className="mt-[3px] block truncate text-[11px] text-fx-ink-3">
                      {uncategorized
                        ? "no category"
                        : `${t.category}${t.subcategory ? ` · ${t.subcategory}` : ""}`}
                      {` · ${t.account} · ${t.person}`}
                    </span>
                  </span>
                  {!compact && (
                    <span
                      className="flex-none rounded-[5px] border border-fx-line px-1.5 py-1 font-fx-mono text-[9.5px] leading-none tracking-[0.05em]"
                      style={{
                        color: uncategorized
                          ? "var(--fx-accent)"
                          : committed.has(t.processed_description)
                            ? "var(--fx-s3)"
                            : "var(--fx-ink-3)",
                      }}
                    >
                      {uncategorized
                        ? "CATEGORISE"
                        : committed.has(t.processed_description)
                          ? "COMMITTED"
                          : (t.subcategory ?? t.category ?? "").toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-[66px] flex-none text-right text-[13.5px] font-semibold text-fx-ink">
                    {nis(t.charged_amount)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && (
          <p className="py-10 text-center text-[12.5px] text-fx-ink-3">
            No transactions match the current filters.
          </p>
        )}
      </div>

      {filtered.length > shown.length && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE)}
          className="mt-[15px] w-full rounded-[10px] border border-fx-line bg-fx-surface-2 py-[11px] text-[12.5px] font-semibold text-fx-ink"
        >
          Show {PAGE} more
        </button>
      )}
    </Card>
  );
}
