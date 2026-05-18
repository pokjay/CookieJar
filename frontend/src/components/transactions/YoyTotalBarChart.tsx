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
import type { TxnYoySpend } from "@/lib/types";
import { useThemeColors } from "@/lib/use-theme-colors";

interface Props {
  data: TxnYoySpend[];
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
      <p className="text-cj-accent-text">{formatCurrencyFull(payload[0].value)}</p>
    </div>
  );
}

export default function YoyTotalBarChart({ data }: Props) {
  const colors = useThemeColors();
  const maxYear = Math.max(...data.map((d) => d.year));
  return (
    <div className="bg-cj-surface border border-cj-border rounded-xl p-6">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} barCategoryGap="30%">
          <XAxis
            dataKey="year"
            tick={{ fill: colors.axis, fontSize: 12 }}
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
          <Bar dataKey="total_spend" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell
                key={d.year}
                fill={d.year === maxYear ? "#3b82f6" : "#1d4ed8"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
