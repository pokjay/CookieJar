"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { formatCurrency, formatCurrencyFull } from "@/lib/formatting";
import type { TxnAvgByCategory } from "@/lib/types";
import { useThemeColors } from "@/lib/use-theme-colors";

interface Props {
  data: TxnAvgByCategory[];
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm">
      <p className="text-cj-text-muted font-medium mb-1">{label}</p>
      <p className="text-cj-positive">{formatCurrencyFull(payload[0].value)}</p>
    </div>
  );
}

const CATEGORY_COLORS = [
  "#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ec4899",
  "#06b6d4", "#f97316", "#84cc16", "#6366f1", "#14b8a6",
];

export default function AvgByCategoryChart({ data }: Props) {
  const colors = useThemeColors();
  if (data.length === 0) return null;
  const chartData = [...data].sort((a, b) => b.avg_monthly_spend - a.avg_monthly_spend);

  // Dynamic height so all category labels are readable
  const height = Math.max(300, chartData.length * 32);

  return (
    <div className="bg-cj-surface border border-cj-border rounded-xl p-6">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
        >
          <XAxis
            type="number"
            tick={{ fill: colors.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => formatCurrency(v)}
          />
          <YAxis
            type="category"
            dataKey="category"
            tick={{ fill: colors.label, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={120}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="avg_monthly_spend" radius={[0, 4, 4, 0]}>
            {chartData.map((d, i) => (
              <Cell
                key={d.category}
                fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
