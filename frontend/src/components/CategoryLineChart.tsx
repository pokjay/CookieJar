"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { CATEGORY_COLORS } from "@/lib/constants";
import { formatCurrency, formatCurrencyFull } from "@/lib/formatting";
import type { NetWorthByCategoryPoint } from "@/lib/types";
import { useThemeColors } from "@/lib/use-theme-colors";

interface CategoryLineChartProps {
  data: NetWorthByCategoryPoint[];
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

export default function CategoryLineChart({ data }: CategoryLineChartProps) {
  const colors = useThemeColors();
  // Get unique categories
  const categories = [...new Set(data.map((d) => d.category))];

  // Pivot: { date, cat1: amount, cat2: amount }
  const dateMap = new Map<string, Record<string, number>>();
  for (const row of data) {
    if (!dateMap.has(row.activity_date)) {
      dateMap.set(row.activity_date, {});
    }
    dateMap.get(row.activity_date)![row.category] = row.amount;
  }

  const chartData = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date: new Date(date).getTime(), ...vals }));

  if (chartData.length === 0) {
    return (
      <div data-testid="chart-category" className="bg-cj-surface border border-cj-border rounded-xl p-6 flex flex-col min-h-[430px]">
        <h3 className="text-sm font-medium text-cj-text-muted mb-4">
          Net Worth by Category Over Time
        </h3>
        <div className="flex-1 flex items-center justify-center text-cj-text-faint text-sm">
          No investment tracking data
        </div>
      </div>
    );
  }

  return (
    <div data-testid="chart-category" className="bg-cj-surface border border-cj-border rounded-xl p-6">
      <h3 className="text-sm font-medium text-cj-text-muted mb-4">
        Net Worth by Category Over Time
      </h3>
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={chartData}>
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
          {categories.map((cat) => (
            <Line
              key={cat}
              type="monotone"
              dataKey={cat}
              stroke={CATEGORY_COLORS[cat] || "#6B7280"}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
