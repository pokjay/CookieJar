"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency, formatCurrencyFull } from "@/lib/formatting";
import type { TxnCategoryTrend } from "@/lib/types";
import { useThemeColors } from "@/lib/use-theme-colors";
import { MONTH_ORDER } from "@/lib/constants";

interface Props {
  data: TxnCategoryTrend[];
}

function MiniLineChart({
  category,
  rows,
  colors,
}: {
  category: string;
  rows: TxnCategoryTrend[];
  colors: { axis: string; label: string; grid: string; cursor: string };
}) {
  const chartData = MONTH_ORDER
    .map((m) => {
      const row = rows.find((r) => r.month_name === m);
      return { month_name: m, spend: row?.spend ?? 0 };
    })
    .filter((_, i) => {
      // Only show months up to the last non-zero month
      return true;
    });

  const maxSpend = Math.max(...chartData.map((d) => d.spend));

  return (
    <div className="bg-cj-surface border border-cj-border rounded-xl p-4">
      <p className="text-xs font-medium text-cj-text-muted mb-1">{category}</p>
      <p className="text-sm font-semibold text-cj-text mb-3">
        {formatCurrencyFull(rows.reduce((s, r) => s + r.spend, 0))}
      </p>
      <ResponsiveContainer width="100%" height={80}>
        <LineChart data={chartData}>
          <XAxis
            dataKey="month_name"
            tick={{ fill: colors.axis, fontSize: 9 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide domain={[0, maxSpend * 1.1 || 100]} />
          <Tooltip
            formatter={(v: number) => formatCurrencyFull(v)}
            contentStyle={{
              background: "#1F2937",
              border: `1px solid ${colors.cursor}`,
              borderRadius: "6px",
              fontSize: "11px",
            }}
            labelStyle={{ color: colors.axis }}
            itemStyle={{ color: "#60A5FA" }}
          />
          <Line
            type="monotone"
            dataKey="spend"
            stroke="#3b82f6"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: "#60a5fa" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function CategoryTrendsGrid({ data }: Props) {
  const colors = useThemeColors();
  if (data.length === 0) return null;

  // Group by category
  const byCategory = new Map<string, TxnCategoryTrend[]>();
  for (const row of data) {
    if (!byCategory.has(row.category)) byCategory.set(row.category, []);
    byCategory.get(row.category)!.push(row);
  }

  // Sort categories by total spend desc
  const sorted = [...byCategory.entries()].sort(
    ([, a], [, b]) =>
      b.reduce((s, r) => s + r.spend, 0) - a.reduce((s, r) => s + r.spend, 0)
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {sorted.map(([category, rows]) => (
        <MiniLineChart key={category} category={category} rows={rows} colors={colors} />
      ))}
    </div>
  );
}
