"use client";

import type { ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EquityGrant } from "@/lib/types";
import {
  grantColor,
  grantKey,
  money2,
  monthYear,
  usd,
  usdShort,
  yearTicks,
  type ExitGridData,
  type FmvMode,
  type HistoryRow,
  type ScenarioRow,
  type VestRow,
} from "./model";

const TICK = { fill: "var(--fx-ink-2)", fontSize: 11, fontFamily: "var(--font-plex-mono)" };
const AXIS_LINE = { stroke: "var(--fx-line)" };

// ── Shared readout ──────────────────────────────────────────────────────────

interface ReadoutRow { key: string; label: string; value: string; color?: string; dashed?: boolean; total?: boolean }

/** One tooltip listing every series at the hovered x: value first, name second, keyed by a line stroke. */
function Readout({ title, rows }: { title: string; rows: ReadoutRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-[10px] border border-fx-line bg-fx-surface px-3 py-2 text-[12px] shadow-fx">
      <p className="mb-1 font-fx-mono text-[11px] text-fx-ink-2">{title}</p>
      {rows.map((r) => (
        <p
          key={r.key}
          className={`flex items-center gap-2 whitespace-nowrap ${r.total ? "mt-1 border-t border-fx-line-2 pt-1" : ""}`}
        >
          <i
            className="inline-block w-3 flex-none border-t-2"
            style={{ borderTopColor: r.color ?? "transparent", borderTopStyle: r.dashed ? "dashed" : "solid" }}
          />
          <b className="fx-num min-w-[72px] font-medium">{r.value}</b>
          <span className="text-fx-ink-2">{r.label}</span>
        </p>
      ))}
    </div>
  );
}

/** A value at the end of a line, in ink (never the series colour). */
function endLabel(lastIndex: number, prefix?: string, fmt: (v: number) => string = usdShort) {
  function EndLabel(props: { x?: number | string; y?: number | string; index?: number; value?: unknown }) {
    const { x, y, index, value } = props;
    if (index !== lastIndex || typeof value !== "number") return <g />;
    return (
      <text x={Number(x) + 8} y={Number(y) + 4} fontSize={11} fontFamily="var(--font-plex-mono)" fill="var(--fx-ink)">
        {prefix && <tspan fill="var(--fx-ink-2)">{prefix} </tspan>}
        {fmt(value)}
      </text>
    );
  }
  return EndLabel;
}

// ── Exit scenarios ──────────────────────────────────────────────────────────

export interface ScenarioSeries { key: string; label: string; short: string; color: string }

export function ExitScenariosChart({
  rows,
  series,
  start,
  earliest,
  end,
}: {
  rows: ScenarioRow[];
  series: ScenarioSeries[];
  start: number;
  earliest: number;
  end: number;
}) {
  const last = rows.length - 1;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={rows} margin={{ top: 16, right: 84, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--fx-line-2)" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={[start, end]}
          ticks={yearTicks(start, end)}
          tickFormatter={(v: number) => String(new Date(v).getFullYear())}
          tick={TICK}
          tickLine={false}
          axisLine={AXIS_LINE}
        />
        <YAxis tick={TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => usdShort(v)} />
        {earliest > start && (
          <ReferenceArea
            x1={start}
            x2={Math.min(earliest, end)}
            fill="var(--fx-shade)"
            fillOpacity={1}
            stroke="none"
            ifOverflow="hidden"
            label={{ value: "No exit expected", position: "insideTopLeft", fill: "var(--fx-ink-2)", fontSize: 11 }}
          />
        )}
        <Tooltip
          cursor={{ stroke: "var(--fx-ink-3)", strokeWidth: 1 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as ScenarioRow;
            return (
              <Readout
                title={`Exit in ${monthYear(new Date(Number(label)))}`}
                rows={series
                  .filter((s) => row[s.key] != null)
                  .map((s) => ({ key: s.key, label: s.label, value: usd(row[s.key] as number), color: s.color }))
                  .reverse()}
              />
            );
          }}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="linear"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--fx-plot-gap)", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
            label={endLabel(last, s.short)}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Exit payout grid ────────────────────────────────────────────────────────

export function ExitGrid({ grid, expanded }: { grid: ExitGridData; expanded: boolean }) {
  const rows = expanded ? grid.rows : grid.rows.filter((r) => r.mine);
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[620px] border-separate border-spacing-[3px] text-[12px]">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left text-[10.5px] font-medium text-fx-ink-3">Exit price ↓ · exit date →</th>
            {grid.dates.map((d) => (
              <th key={d.getTime()} className="px-2 py-1 text-center text-[10.5px] font-medium text-fx-ink-3">
                {d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className={`whitespace-nowrap px-2 py-1 ${r.mine ? "font-semibold text-fx-accent" : "text-fx-ink-2"}`}>{r.label}</td>
              {r.values.map((v, j) => {
                // Square root keeps low cells distinguishable on a wide range.
                const k = grid.max > 0 ? Math.sqrt(v / grid.max) : 0;
                return (
                  <td
                    key={j}
                    title={`${r.label} in ${monthYear(grid.dates[j])}: ${usd(v)}`}
                    className={`fx-num rounded-[6px] px-2 py-1.5 text-center ${r.mine ? "outline outline-2 -outline-offset-2 outline-fx-ink" : ""}`}
                    style={{
                      background: `color-mix(in oklab, var(--fx-heat-hi) ${Math.round(k * 100)}%, var(--fx-heat-lo))`,
                      color: k > 0.55 ? "var(--fx-heat-ink)" : "var(--fx-ink)",
                    }}
                  >
                    {usdShort(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Vesting ahead (monthly gains / yearly vesting) ──────────────────────────

export function VestingAheadChart({
  rows,
  grants,
  view,
  totalLabel,
  buyoutLabel,
}: {
  rows: VestRow[];
  grants: EquityGrant[];
  view: "monthly" | "yearly";
  totalLabel: string;
  buyoutLabel: string;
}) {
  const monthly = view === "monthly";
  const tick = (props: { x?: number | string; y?: number | string; payload?: { value: string } }) => {
    const v = props.payload?.value ?? "";
    const now = v.endsWith("· now");
    return (
      <text x={Number(props.x)} y={Number(props.y) + 12} textAnchor="middle" fontSize={11} fontFamily="var(--font-plex-mono)" fill={now ? "var(--fx-ink)" : "var(--fx-ink-2)"} fontWeight={now ? 600 : 400}>
        {v}
      </text>
    );
  };
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={rows} margin={{ top: 20, right: 12, bottom: 0, left: 0 }} barCategoryGap="22%">
        <CartesianGrid stroke="var(--fx-line-2)" vertical={false} />
        {/* Labels thin out to fit the width (36 months on a phone would collide). */}
        <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={AXIS_LINE} interval="preserveStartEnd" minTickGap={monthly ? 28 : 8} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => usdShort(v)} />
        <Tooltip
          cursor={{ fill: "var(--fx-ink)", fillOpacity: 0.05 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as VestRow;
            const items: ReadoutRow[] = grants
              .map((g, i) => ({ g, i, v: Number(row[grantKey(g)] ?? 0) }))
              .filter((x) => x.v > 0)
              .map(({ g, i, v }) => ({ key: grantKey(g), label: g.name || "Grant", value: usd(v), color: grantColor(i) }))
              .reverse();
            items.push({ key: "total", label: totalLabel, value: usd(row.total), total: true });
            if (monthly && row.buyout != null) items.push({ key: "buyout", label: buyoutLabel, value: usd(row.buyout), color: "var(--fx-ink)" });
            return <Readout title={row.title} rows={items} />;
          }}
        />
        {grants.map((g, i) => (
          <Bar
            key={g.id}
            dataKey={grantKey(g)}
            name={g.name || "Grant"}
            stackId="v"
            fill={grantColor(i)}
            stroke="var(--fx-plot-gap)"
            strokeWidth={1}
            maxBarSize={24}
            radius={i === grants.length - 1 ? [4, 4, 0, 0] : 0}
            isAnimationActive={false}
          />
        ))}
        {!monthly && (
          <Line dataKey="total" stroke="none" dot={false} activeDot={false} legendType="none" isAnimationActive={false}>
            <LabelList
              dataKey="total"
              position="top"
              offset={8}
              fontSize={10.5}
              fontFamily="var(--font-plex-mono)"
              fill="var(--fx-ink-2)"
              formatter={(v: unknown) => (Number(v) > 0 ? usdShort(Number(v)) : "")}
            />
          </Line>
        )}
        {monthly && (
          <Line type="step" dataKey="buyout" name={buyoutLabel} stroke="var(--fx-ink)" strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── 409A history & outlook ──────────────────────────────────────────────────

export interface HistoryPath { mode: FmvMode; label: string; color: string; dashed: boolean }

export function HistoryChart({
  rows,
  paths,
  selected,
  start,
  end,
  today,
}: {
  rows: HistoryRow[];
  paths: HistoryPath[];
  selected: FmvMode;
  start: number;
  end: number;
  today: number;
}) {
  const last = rows.length - 1;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={rows} margin={{ top: 24, right: 64, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--fx-line-2)" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={[start, end]}
          ticks={yearTicks(start, end)}
          tickFormatter={(v: number) => String(new Date(v).getFullYear())}
          tick={TICK}
          tickLine={false}
          axisLine={AXIS_LINE}
        />
        <YAxis tick={TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => `$${v}`} />
        <ReferenceLine
          x={today}
          stroke="var(--fx-ink-3)"
          strokeDasharray="4 4"
          label={{ value: "Today", position: "top", fill: "var(--fx-ink-2)", fontSize: 11 }}
        />
        <Tooltip
          cursor={{ stroke: "var(--fx-ink-3)", strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as HistoryRow;
            const items: ReadoutRow[] = [];
            if (row.hist != null) items.push({ key: "hist", label: `${row.name} strike`, value: money2(row.hist), color: "var(--fx-at-1)" });
            for (const p of paths) {
              const v = row[p.mode];
              if (v != null && row.hist == null) items.push({ key: p.mode, label: p.label, value: money2(v), color: p.color, dashed: p.dashed });
            }
            return <Readout title={new Date(row.t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} rows={items} />;
          }}
        />
        <Line
          dataKey="hist"
          name="Grant strikes"
          stroke="var(--fx-at-1)"
          strokeWidth={2}
          connectNulls
          isAnimationActive={false}
          dot={{ r: 4, fill: "var(--fx-at-1)", stroke: "var(--fx-plot-gap)", strokeWidth: 2 }}
          activeDot={{ r: 5 }}
        >
          <LabelList dataKey="histLabel" position="top" offset={10} fontSize={10.5} fontFamily="var(--font-plex-mono)" fill="var(--fx-ink-2)" />
        </Line>
        <Line dataKey="held" stroke="var(--fx-ink-3)" strokeWidth={1.5} strokeDasharray="2 4" connectNulls dot={false} activeDot={false} legendType="none" isAnimationActive={false} />
        {paths.map((p) => (
          <Line
            key={p.mode}
            dataKey={p.mode}
            name={p.label}
            stroke={p.color}
            strokeWidth={p.mode === selected ? 2.5 : 1.5}
            strokeDasharray={p.dashed ? "6 4" : undefined}
            connectNulls
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
            label={endLabel(last, undefined, money2)}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Legend & data table ─────────────────────────────────────────────────────

export interface LegendItem { label: string; color: string; line?: boolean; dashed?: boolean }

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-fx-ink-2">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.line ? (
            <i className="inline-block w-4 flex-none border-t-2" style={{ borderTopColor: it.color, borderTopStyle: it.dashed ? "dashed" : "solid" }} />
          ) : (
            <i className="inline-block h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Every chart's numbers, readable without hovering. */
export function DataTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <details className="mt-3">
      <summary className="w-max cursor-pointer text-[11.5px] text-fx-ink-2 hover:text-fx-ink">Data table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-fx-line text-[10.5px] text-fx-ink-3">
              {headers.map((h, i) => (
                <th key={h} className={`px-2 py-1.5 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-fx-line-2 last:border-0">
                {r.map((c, j) => (
                  <td key={j} className={`whitespace-nowrap px-2 py-1.5 ${j ? "fx-num text-right" : ""}`}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
