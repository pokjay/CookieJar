"use client";

import InteractiveChart from "@/components/ledger/InteractiveChart";
import { Card } from "@/components/ledger/ui";
import { nis, pct, signColor, monthLabel } from "@/components/ledger/format";
import type { ChartSeries } from "@/lib/types";
import type { SpendingModel } from "./model";
import { keyToYearMonth } from "./model";

interface Comparison {
  label: string;
  changePct: number;
  baseline: number;
  throughDay: number;
}

export default function SpendingHero({
  model,
  monthKey: key,
  compact,
}: {
  model: SpendingModel;
  monthKey: number;
  compact: boolean;
}) {
  const month = model.byKey.get(key);
  const day = model.coverageDay(key);
  const cur = month?.cumulative.slice(0, day) ?? [];
  const prev = model.byKey.get(key - 1)?.cumulative ?? [];
  const lastYear = model.byKey.get(key - 12)?.cumulative ?? [];

  const total = cur[cur.length - 1] ?? 0;
  const days = Math.max(cur.length, prev.length, lastYear.length, 1);
  // Comparison lines run the full month; flatten them past their own end so the
  // shorter series doesn't slope back to zero.
  const extend = (a: number[]) =>
    a.length ? Array.from({ length: days }, (_, i) => a[Math.min(i, a.length - 1)]) : [];

  const max = Math.max(...cur, ...prev, ...lastYear, 1) * 1.08;

  const { year, month: m } = keyToYearMonth(key);
  const prevLabel = (() => {
    const p = keyToYearMonth(key - 1);
    return monthLabel(p.year, p.month);
  })();
  const lyLabel = (() => {
    const p = keyToYearMonth(key - 12);
    return monthLabel(p.year, p.month);
  })();

  const series: ChartSeries[] = [
    { label: monthLabel(year, m), values: cur, color: "var(--fx-accent)", width: 2.4, fill: true },
    { label: prevLabel, values: extend(prev), color: "var(--fx-ink-3)", width: 1.6, dash: "6 5" },
    { label: lyLabel, values: extend(lastYear), color: "var(--fx-s3)", width: 1.6, dash: "2 5" },
  ].filter((s) => s.values.length > 1);

  const comparisons: Comparison[] = [
    { key: key - 1, label: prevLabel, values: prev },
    { key: key - 12, label: lyLabel, values: lastYear },
  ]
    .filter((c) => c.values.length > 0)
    .map((c) => {
      const throughDay = Math.min(day, c.values.length);
      const baseline = c.values[throughDay - 1] ?? 0;
      return {
        label: `vs ${c.label}`,
        changePct: baseline ? ((total - baseline) / baseline) * 100 : 0,
        baseline,
        throughDay,
      };
    });

  const isPartial = key === model.latestKey && day < (month?.days ?? 0);
  const projection = isPartial && day ? (total / day) * (month?.days ?? day) : total;

  return (
    <Card className="!px-5 !py-[22px] pb-4">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
        <div className="min-w-0 flex-1 basis-[210px]">
          <div className="mb-1.5 text-xs text-fx-ink-2">
            {isPartial ? "Spent so far this month" : `Spent in ${monthLabel(year, m)}`}
          </div>
          <div className={`fx-num leading-none ${compact ? "text-[40px]" : "text-[50px]"}`}>
            {nis(total)}
          </div>
          <div className="mt-[9px] text-xs text-fx-ink-3">
            {isPartial
              ? `On pace for ${nis(projection)} · ${nis(total / Math.max(day, 1))} a day`
              : `${nis(total / Math.max(month?.days ?? 1, 1))} a day on average`}
          </div>
        </div>
        {comparisons.map((c) => (
          <div key={c.label} className="min-w-0 flex-[0_1_152px]">
            <div className="mb-[7px] text-[11.5px] text-fx-ink-2">{c.label}</div>
            <div
              className="fx-num text-2xl"
              style={{ color: signColor(c.changePct, "down") }}
            >
              {pct(c.changePct)}
            </div>
            <div className="mt-1.5 text-[11.5px] leading-[1.45] text-fx-ink-3">
              {nis(c.baseline)} by day {c.throughDay}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 -mx-5">
        <InteractiveChart
          series={series}
          height={compact ? 190 : 280}
          min={0}
          max={max}
          pointCount={days}
          markerSeries={0}
          ariaLabel={`Cumulative spending through ${monthLabel(year, m)}`}
          tooltipTitle={(i) => `Day ${i + 1}`}
          tooltipRows={(i) =>
            series.map((s) => ({
              label: s.label,
              value: i < s.values.length ? nis(s.values[i]) : "—",
              color: s.color,
            }))
          }
        />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap gap-[15px]">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-[7px] text-[11.5px] text-fx-ink-2">
              <span className="h-0.5 w-3.5" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <span className="font-fx-mono text-[10.5px] text-fx-ink-3">day 1 → {days}</span>
      </div>
    </Card>
  );
}
