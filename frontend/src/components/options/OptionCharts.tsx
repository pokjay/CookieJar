"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OptionGrant } from "@/lib/types";
import { grantColor, grantKey, usd, usdShort, type TimelineRow } from "./model";

const TICK = { fill: "var(--fx-ink-3)", fontSize: 11, fontFamily: "var(--font-plex-mono)" };

interface TooltipEntry {
  dataKey?: string | number;
  name?: string;
  value?: number;
  color?: string;
}

function StackTooltip({
  active,
  payload,
  title,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  title: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="rounded-[10px] border border-fx-line bg-fx-surface px-3 py-2 text-[12px] shadow-fx">
      <p className="mb-1 font-fx-mono text-fx-ink-2">{title}</p>
      {[...payload].reverse().map((p) => (
        <p key={String(p.dataKey)} className="flex justify-between gap-4">
          <span className="flex items-center gap-1.5 text-fx-ink-2">
            <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="fx-num">{usd(p.value ?? 0)}</span>
        </p>
      ))}
      <p className="mt-1 flex justify-between gap-4 border-t border-fx-line-2 pt-1 font-semibold">
        <span>Total</span>
        <span className="fx-num">{usd(total)}</span>
      </p>
    </div>
  );
}

function bands(grants: OptionGrant[]) {
  return grants.map((g, i) => (
    <Area
      key={g.id}
      type="linear"
      dataKey={grantKey(g)}
      name={g.name || "Grant"}
      stackId="1"
      stroke={grantColor(i)}
      fill={grantColor(i)}
      fillOpacity={0.28}
      strokeWidth={1.5}
      isAnimationActive={false}
      activeDot={{ r: 3 }}
    />
  ));
}

export function PriceValueChart({
  grants,
  rows,
  price,
  fmv,
  maxPrice,
  markerValue,
}: {
  grants: OptionGrant[];
  rows: Record<string, number>[];
  price: number;
  fmv: number;
  maxPrice: number;
  markerValue: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={rows} margin={{ top: 22, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--fx-line-2)" vertical={false} />
        <XAxis
          dataKey="price"
          type="number"
          domain={[0, maxPrice]}
          tick={TICK}
          tickLine={false}
          axisLine={{ stroke: "var(--fx-line)" }}
          tickFormatter={(v: number) => `$${v}`}
        />
        <YAxis
          tick={TICK}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => usdShort(v)}
        />
        <Tooltip
          cursor={{ stroke: "var(--fx-ink-3)", strokeWidth: 1 }}
          content={({ active, payload, label }) => (
            <StackTooltip
              active={active}
              payload={payload as readonly TooltipEntry[]}
              title={`At $${Number(label).toFixed(2)} / share`}
            />
          )}
        />
        {bands(grants)}
        {fmv > 0 && fmv <= maxPrice && (
          <ReferenceLine
            x={fmv}
            stroke="var(--fx-ink-3)"
            strokeDasharray="4 4"
            label={{ value: "409A", position: "insideTopLeft", fill: "var(--fx-ink-2)", fontSize: 11 }}
          />
        )}
        <ReferenceLine
          x={price}
          stroke="var(--fx-ink)"
          strokeWidth={1.5}
          label={{
            value: `$${price.toFixed(2)} · ${usdShort(markerValue)}`,
            position: "top",
            fill: "var(--fx-ink)",
            fontSize: 11,
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function VestingTimelineChart({
  grants,
  rows,
  todayLabel,
}: {
  grants: OptionGrant[];
  rows: TimelineRow[];
  todayLabel: string | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={rows} margin={{ top: 22, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--fx-line-2)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={TICK}
          tickLine={false}
          axisLine={{ stroke: "var(--fx-line)" }}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          tick={TICK}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => usdShort(v)}
        />
        <Tooltip
          cursor={{ stroke: "var(--fx-ink-3)", strokeWidth: 1 }}
          content={({ active, payload, label }) => (
            <StackTooltip active={active} payload={payload as readonly TooltipEntry[]} title={String(label)} />
          )}
        />
        {bands(grants)}
        {todayLabel && (
          <ReferenceLine
            x={todayLabel}
            stroke="var(--fx-ink)"
            strokeWidth={1.5}
            label={{ value: "Today", position: "top", fill: "var(--fx-ink)", fontSize: 11 }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
