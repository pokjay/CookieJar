"use client";

import { useState } from "react";
import { Card } from "@/components/ledger/ui";
import {
  categoryColor,
  MONTHS,
  monthLabel,
  monthLabelShort,
  nis,
  nisShort,
  pct,
  signColor,
} from "@/components/ledger/format";
import type { SpendingModel } from "./model";
import { keyToYearMonth } from "./model";

const MONTHS_BACK = 24;
/** Label every quarter — 8 ticks across 24 months stays readable at card width. */
const LABEL_EVERY = 3;

export default function LongTermView({
  model,
  monthKey: key,
  category,
  open,
  onToggle,
  onSelectMonth,
}: {
  model: SpendingModel;
  monthKey: number;
  category: string | null;
  open: boolean;
  onToggle: () => void;
  /** Jump the whole page to a month by clicking its bar. */
  onSelectMonth?: (key: number) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  // Anchor on the newest month with data rather than the selected one, so jumping
  // back doesn't hide everything that came after it. The window slides only far
  // enough to keep the selected month on screen.
  const end = Math.min(model.latestKey, key + MONTHS_BACK - 1);
  const bars = Array.from({ length: MONTHS_BACK }, (_, i) => {
    const k = end - (MONTHS_BACK - 1) + i;
    const value = category
      ? model.categoryTotal(k, category)
      : model.totalThrough(k, 31);
    return { key: k, value };
  });
  const max = Math.max(...bars.map((b) => b.value), 1);
  const average = bars.reduce((s, b) => s + b.value, 0) / bars.length;

  const recent = bars.slice(12).reduce((s, b) => s + b.value, 0) / 12;
  const earlier = bars.slice(0, 12).reduce((s, b) => s + b.value, 0) / 12;

  const color = category ? categoryColor(category) : "var(--fx-accent)";

  const active = hovered === null ? null : bars[hovered];
  const activeYm = active ? keyToYearMonth(active.key) : null;
  // Keep the tooltip's centre off the card edges so it never spills out.
  const tipLeft =
    hovered === null ? 0 : Math.min(90, Math.max(10, ((hovered + 0.5) / MONTHS_BACK) * 100));

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
          {/* pt leaves room for the tooltip to clear the tallest bar (~41px tall) */}
          <div className="relative pt-12" onPointerLeave={() => setHovered(null)}>
            <div className="flex h-32 items-end gap-[2px]">
              {bars.map((b, i) => {
                const { year, month } = keyToYearMonth(b.key);
                const isCurrent = b.key === key;
                // Only months the model actually has are worth jumping to; the rest
                // stay hoverable so the tooltip still explains the gap.
                const selectable = !!onSelectMonth && !isCurrent && model.byKey.has(b.key);
                return (
                  <button
                    key={b.key}
                    type="button"
                    tabIndex={0}
                    onPointerEnter={() => setHovered(i)}
                    onFocus={() => setHovered(i)}
                    onBlur={() => setHovered((h) => (h === i ? null : h))}
                    onClick={selectable ? () => onSelectMonth(b.key) : undefined}
                    aria-label={
                      `${monthLabel(year, month)}: ${nis(b.value)}` +
                      (selectable ? " — show this month" : "")
                    }
                    className={`flex h-full min-w-0 flex-1 flex-col justify-end rounded-t-[4px] focus:outline-none focus-visible:ring-2 focus-visible:ring-fx-accent ${
                      selectable ? "cursor-pointer" : "cursor-default"
                    }`}
                  >
                    <div
                      className="rounded-t-[4px] transition-opacity"
                      style={{
                        background: color,
                        opacity: isCurrent || hovered === i ? 1 : 0.4,
                        height: `${(b.value / max) * 100}%`,
                      }}
                    />
                  </button>
                );
              })}
            </div>

            {/* Average across the 24 months — dashed so it never reads as data. */}
            <div
              className="pointer-events-none absolute inset-x-0 flex justify-end border-t border-dashed border-fx-ink-3"
              style={{ bottom: `${(average / max) * 128}px` }}
            >
              <span className="-translate-y-[calc(100%+3px)] rounded-[4px] bg-fx-surface px-1 py-0.5 font-fx-mono text-[9.5px] leading-none text-fx-ink-3">
                avg {nisShort(average)}
              </span>
            </div>

            {active && activeYm && (
              // fx-surface, not fx-card-bg: the card token is a 3% wash in dark mode,
              // so a floating element painted with it shows the bars straight through.
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-[10px] border border-fx-line bg-fx-surface px-2.5 py-1.5 shadow-fx"
                style={{
                  left: `${tipLeft}%`,
                  bottom: `calc(${(active.value / max) * 128}px + 6px)`,
                }}
              >
                <div className="fx-num text-[13px] leading-none text-fx-ink">
                  {nis(active.value)}
                </div>
                <div className="mt-1 text-[10.5px] leading-none text-fx-ink-3">
                  {monthLabel(activeYm.year, activeYm.month)}
                  {average > 0 && (
                    <>
                      {" · "}
                      <span style={{ color: signColor(active.value - average, "down") }}>
                        {pct(((active.value - average) / average) * 100)}
                      </span>
                      {" vs avg"}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Axis labels share the bar grid, so each tick sits under its own bar. */}
          <div className="mt-2 flex gap-[2px]">
            {bars.map((b) => {
              const { year, month } = keyToYearMonth(b.key);
              return (
                <div key={b.key} className="min-w-0 flex-1">
                  {month % LABEL_EVERY === 0 && (
                    <span className="block whitespace-nowrap text-center font-fx-mono text-[9.5px] leading-none text-fx-ink-3">
                      {month === 0 ? monthLabelShort(year, month) : MONTHS[month]}
                    </span>
                  )}
                </div>
              );
            })}
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
