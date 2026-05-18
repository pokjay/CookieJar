"use client";

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency, formatCurrencyFull } from "@/lib/formatting";
import { useThemeColors } from "@/lib/use-theme-colors";
import type { CashFlowMonthly } from "@/lib/types";

interface CashFlowAreaChartProps {
  data: CashFlowMonthly[];
}

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
          {p.name}:{" "}
          {p.name === "Savings %" ? `${p.value.toFixed(1)}%` : formatCurrencyFull(p.value)}
        </p>
      ))}
    </div>
  );
}

export default function CashFlowAreaChart({ data }: CashFlowAreaChartProps) {
  const colors = useThemeColors();
  return (
    <div className="bg-cj-surface border border-cj-border rounded-xl p-6">
      <h3 className="text-sm font-medium text-cj-text-muted mb-4">
        Income, Expense &amp; Savings Rate
      </h3>
      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart data={data}>
          <defs>
            <linearGradient id="gradIncome" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradExpense" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="month_name"
            tick={{ fill: colors.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="amount"
            tick={{ fill: colors.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => formatCurrency(v)}
          />
          <YAxis
            yAxisId="pct"
            orientation="right"
            tick={{ fill: colors.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            domain={["auto", "auto"]}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: colors.cursor, strokeWidth: 1 }} />
          <Legend wrapperStyle={{ color: colors.axis, fontSize: "12px" }} />
          <Area
            yAxisId="amount"
            type="monotone"
            dataKey="income"
            name="Income"
            stroke="#10b981"
            fill="url(#gradIncome)"
            strokeWidth={2}
          />
          <Area
            yAxisId="amount"
            type="monotone"
            dataKey="expense"
            name="Expense"
            stroke="#ef4444"
            fill="url(#gradExpense)"
            strokeWidth={2}
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="savings_pct"
            name="Savings %"
            stroke="#3b82f6"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={{ fill: "#3b82f6", r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
