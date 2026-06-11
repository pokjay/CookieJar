"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency, formatCurrencyFull } from "@/lib/formatting";
import type { TxnMonthlyYoy } from "@/lib/types";
import { useThemeColors } from "@/lib/use-theme-colors";
import { MONTH_ORDER } from "@/lib/constants";

interface Props {
  data: TxnMonthlyYoy[];
}

const YEAR_COLORS = ["#1d4ed8", "#3b82f6", "#93c5fd"];

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm space-y-1">
      <p className="text-cj-text-muted font-medium">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {formatCurrencyFull(p.value)}
        </p>
      ))}
    </div>
  );
}

export default function MonthlyYoyChart({ data }: Props) {
  const colors = useThemeColors();
  const { years, chartData } = useMemo(() => {
    const years = [...new Set(data.map((d) => d.year))].sort();
    // Build pivot: month_name → { [year]: spend }
    const pivot = new Map<string, Record<number, number>>();
    for (const row of data) {
      if (!pivot.has(row.month_name)) pivot.set(row.month_name, {});
      pivot.get(row.month_name)![row.year] = row.spend;
    }
    const chartData = MONTH_ORDER
      .filter((m) => pivot.has(m))
      .map((m) => ({ month_name: m, ...pivot.get(m)! }));
    return { years, chartData };
  }, [data]);

  return (
    <div className="bg-cj-surface border border-cj-border rounded-xl p-6">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} barCategoryGap="20%">
          <XAxis
            dataKey="month_name"
            tick={{ fill: colors.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: colors.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => formatCurrency(v)}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Legend wrapperStyle={{ color: colors.axis, fontSize: "12px" }} />
          {years.map((year, i) => (
            <Bar
              key={year}
              dataKey={year}
              name={String(year)}
              fill={YEAR_COLORS[i % YEAR_COLORS.length]}
              radius={[3, 3, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
