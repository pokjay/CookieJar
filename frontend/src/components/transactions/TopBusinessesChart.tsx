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
import type { TxnTopBusiness } from "@/lib/types";
import { useThemeColors } from "@/lib/use-theme-colors";

interface Props {
  data: TxnTopBusiness[];
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
      <p className="text-cj-text-3 font-medium mb-1">{label}</p>
      <p className="text-cj-text">{formatCurrencyFull(payload[0].value)}</p>
    </div>
  );
}

export default function TopBusinessesChart({ data }: Props) {
  const colors = useThemeColors();
  if (data.length === 0) return null;
  const chartData = [...data].sort((a, b) => a.total_spend - b.total_spend); // ascending for horizontal bar
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
            dataKey="name"
            tick={{ fill: colors.label, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={150}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="total_spend" radius={[0, 4, 4, 0]}>
            {chartData.map((d, i) => (
              <Cell
                key={d.name}
                fill={`hsl(${38 + i * 6}, 80%, ${55 - i * 2}%)`}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
