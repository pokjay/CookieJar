"use client";

import { Card } from "@/components/ledger/ui";
import { categoryColor, monthLabel, nis, pct } from "@/components/ledger/format";
import type { SpendingModel } from "./model";
import { keyToYearMonth } from "./model";

const MONTHS_BACK = 24;

export default function LongTermView({
  model,
  monthKey: key,
  category,
  open,
  onToggle,
}: {
  model: SpendingModel;
  monthKey: number;
  category: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const bars = Array.from({ length: MONTHS_BACK }, (_, i) => {
    const k = key - (MONTHS_BACK - 1) + i;
    const value = category
      ? model.categoryTotal(k, category)
      : model.totalThrough(k, 31);
    return { key: k, value };
  });
  const max = Math.max(...bars.map((b) => b.value), 1);

  const recent = bars.slice(12).reduce((s, b) => s + b.value, 0) / 12;
  const earlier = bars.slice(0, 12).reduce((s, b) => s + b.value, 0) / 12;

  const first = keyToYearMonth(bars[0].key);
  const last = keyToYearMonth(bars[bars.length - 1].key);
  const color = category ? categoryColor(category) : "var(--fx-accent)";

  return (
    <Card>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <span className="text-[12.5px] font-semibold text-fx-ink">Long-term view</span>
        <span className="text-[11.5px] text-fx-ink-3">
          {category ? `24 months of ${category}` : "24 months of total spend"}
        </span>
        <span className="flex-1" />
        <span className="text-xs text-fx-accent">{open ? "Hide −" : "Show +"}</span>
      </button>

      {open && (
        <div className="mt-[17px]">
          <div className="flex h-32 items-end gap-[3px]">
            {bars.map((b) => {
              const { year, month } = keyToYearMonth(b.key);
              return (
                <div
                  key={b.key}
                  title={`${monthLabel(year, month)} · ${nis(b.value)}`}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end"
                >
                  <div
                    className="rounded-t-[3px]"
                    style={{
                      background: color,
                      opacity: b.key === key ? 1 : 0.4,
                      height: `${(b.value / max) * 100}%`,
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between font-fx-mono text-[10px] leading-none text-fx-ink-3">
            <span>{monthLabel(first.year, first.month)}</span>
            <span>{monthLabel(last.year, last.month)}</span>
          </div>
          <p className="mt-[13px] text-[12.5px] leading-[1.55] text-fx-ink-2">
            Last 12 months average {nis(recent)} a month,{" "}
            {pct(earlier ? ((recent - earlier) / earlier) * 100 : 0)} on the 12 before that.
          </p>
        </div>
      )}
    </Card>
  );
}
