"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { getPersonColor } from "@/lib/constants";
import { formatCurrency, formatCurrencyFull } from "@/lib/formatting";
import { useThemeColors } from "@/lib/use-theme-colors";
import type { NetWorthPoint } from "@/lib/types";

interface NetWorthAreaChartProps {
  data: NetWorthPoint[];
  persons: string[];
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  const dateStr = label
    ? new Date(label).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "";
  return (
    <div className="bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm">
      <p className="text-cj-text-muted mb-1">{dateStr}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {formatCurrencyFull(p.value)}
        </p>
      ))}
    </div>
  );
}

export default function NetWorthAreaChart({
  data,
  persons,
}: NetWorthAreaChartProps) {
  const colors = useThemeColors();
  // Pivot data: { date, person1: amount, person2: amount }
  const dateMap = new Map<string, Record<string, number>>();
  for (const row of data) {
    if (!dateMap.has(row.activity_date)) {
      dateMap.set(row.activity_date, {} as Record<string, number>);
    }
    const entry = dateMap.get(row.activity_date)!;
    entry[row.person] = row.total_amount;
  }

  const chartData = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date: new Date(date).getTime(), ...vals }));

  return (
    <div data-testid="chart-area" className="bg-cj-surface border border-cj-border rounded-xl p-6">
      <h3 className="text-sm font-medium text-cj-text-muted mb-4">
        Net Worth Over Time
      </h3>
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={chartData}>
          <defs>
            {persons.map((person, i) => (
              <linearGradient
                key={person}
                id={`gradient-${person}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={getPersonColor(person, i)}
                  stopOpacity={0.3}
                />
                <stop
                  offset="100%"
                  stopColor={getPersonColor(person, i)}
                  stopOpacity={0}
                />
              </linearGradient>
            ))}
          </defs>
          <XAxis
            dataKey="date"
            type="number"
            scale="time"
            domain={["auto", "auto"]}
            tick={{ fill: colors.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => {
              const d = new Date(v);
              return `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
            }}
          />
          <YAxis
            tick={{ fill: colors.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => formatCurrency(v)}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: colors.cursor, strokeWidth: 1 }} />
          <Legend wrapperStyle={{ color: colors.axis, fontSize: "12px" }} />
          {persons.map((person, i) => (
            <Area
              key={person}
              type="monotone"
              dataKey={person}
              stackId="1"
              stroke={getPersonColor(person, i)}
              fill={`url(#gradient-${person})`}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
