"use client";

import { useMemo } from "react";
import { Card, SegmentedControl, Sparkline } from "@/components/ledger/ui";
import { categoryColor, nis, pct, signColor } from "@/components/ledger/format";
import type { SpendingModel } from "./model";
import { UNCATEGORIZED } from "./model";

export type CategorySort = "amount" | "change" | "name";

const SORT_OPTIONS = [
  { value: "amount" as const, label: "Biggest" },
  { value: "change" as const, label: "Most changed" },
  { value: "name" as const, label: "A–Z" },
];

export default function CategoryTable({
  model,
  monthKey: key,
  sort,
  onSortChange,
  selected,
  onSelect,
  compact,
}: {
  model: SpendingModel;
  monthKey: number;
  sort: CategorySort;
  onSortChange: (sort: CategorySort) => void;
  selected: string | null;
  onSelect: (category: string | null) => void;
  compact: boolean;
}) {
  const day = model.coverageDay(key);

  const rows = useMemo(() => {
    const current = model.categoryTotalsThrough(key, day);
    const lastYear = model.categoryTotalsThrough(key - 12, day);

    return [...current.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([name, amount]) => {
        const priorMonths = [1, 2, 3].map((n) => model.categoryTotal(key - n, name));
        const average = priorMonths.reduce((s, v) => s + v, 0) / 3;
        const change3mo = average ? ((amount - average) / average) * 100 : 0;
        const lastYearAmount = lastYear.get(name) ?? 0;
        const changeYoy = lastYearAmount ? ((amount - lastYearAmount) / lastYearAmount) * 100 : 0;
        const trend = Array.from({ length: 13 }, (_, i) => model.categoryTotal(key - 12 + i, name));
        return { name, amount, change3mo, changeYoy, trend };
      })
      .sort((a, b) => {
        if (sort === "amount") return b.amount - a.amount;
        if (sort === "change") return b.change3mo - a.change3mo;
        return a.name.localeCompare(b.name);
      });
  }, [model, key, day, sort]);

  const max = Math.max(...rows.map((r) => r.amount), 1);

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-baseline gap-2.5">
        <span className="text-[12.5px] font-semibold">Where the money went</span>
        <div className="min-w-[8px] flex-1" />
        <SegmentedControl
          options={SORT_OPTIONS}
          value={sort}
          onChange={onSortChange}
          size="sm"
          ariaLabel="Sort categories"
        />
      </div>
      <p className="mb-[13px] text-[11.5px] text-fx-ink-3">
        Click a category to filter the list below · Δ compares the same days of each month
      </p>

      <div className="flex items-center gap-2.5 border-b border-fx-line px-1.5 pb-[9px] font-fx-mono text-[9.5px] font-medium leading-none tracking-[0.08em] text-fx-ink-3">
        <span className="min-w-0 flex-1 basis-[110px]">CATEGORY</span>
        <span className="w-[82px] flex-none text-right">MONTH</span>
        {!compact && (
          <>
            <span className="w-16 flex-none text-right">Δ 3-MO</span>
            <span className="w-16 flex-none text-right">Δ 1-YR</span>
            <span className="w-[88px] flex-none">13-MO</span>
          </>
        )}
      </div>

      {rows.map((r) => {
        const color = r.name === UNCATEGORIZED ? "var(--fx-ink-3)" : categoryColor(r.name);
        const active = selected === r.name;
        return (
          <button
            key={r.name}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? null : r.name)}
            className={`flex w-full items-center gap-2.5 rounded-lg border-b border-fx-line-2 px-1.5 py-[11px] text-left transition-colors ${
              active ? "bg-fx-accent-soft" : "hover:bg-fx-surface-2"
            }`}
          >
            <span className="flex min-w-0 flex-1 basis-[110px] items-center gap-[9px]">
              <span
                className="h-2 w-2 flex-none rounded-sm"
                style={{ background: color }}
              />
              <span className="min-w-0">
                <span
                  className={`block truncate text-[12.5px] font-semibold ${
                    r.name === UNCATEGORIZED ? "text-fx-ink-2" : "text-fx-ink"
                  }`}
                >
                  {r.name}
                </span>
                <span className="mt-1.5 block h-[3px] overflow-hidden rounded-sm bg-fx-surface-2">
                  <span
                    className="block h-full rounded-sm"
                    style={{ background: color, width: `${(r.amount / max) * 100}%` }}
                  />
                </span>
              </span>
            </span>
            <span className="w-[82px] flex-none text-right text-[13px] font-semibold text-fx-ink">
              {nis(r.amount)}
            </span>
            {!compact && (
              <>
                <span
                  className="w-16 flex-none text-right text-xs"
                  style={{ color: signColor(r.change3mo, "down") }}
                >
                  {pct(r.change3mo)}
                </span>
                <span
                  className="w-16 flex-none text-right text-xs"
                  style={{ color: signColor(r.changeYoy, "down") }}
                >
                  {pct(r.changeYoy)}
                </span>
                <span className="w-[88px] flex-none">
                  <Sparkline values={r.trend} color={color} height={24} />
                </span>
              </>
            )}
          </button>
        );
      })}
    </Card>
  );
}
