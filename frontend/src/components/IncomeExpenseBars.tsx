"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import { formatCurrency, formatCurrencyFull } from "@/lib/formatting";
import { useThemeColors } from "@/lib/use-theme-colors";

interface IncomeExpenseBarsProps {
  avgIncome: number;
  avgExpense: number;
  year: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm">
      <p className="text-cj-text font-medium">
        {formatCurrencyFull(payload[0].value)}
      </p>
    </div>
  );
}

export default function IncomeExpenseBars({
  avgIncome,
  avgExpense,
  year,
}: IncomeExpenseBarsProps) {
  const colors = useThemeColors();
  const data = [
    { name: "Income", value: avgIncome, color: "#2ecc71" },
    { name: "Expense", value: Math.abs(avgExpense), color: "#e74c3c" },
  ];

  return (
    <div data-testid="chart-bars" className="bg-cj-surface border border-cj-border rounded-xl p-6">
      <h3 className="text-sm font-medium text-cj-text-muted mb-4">
        Avg Monthly Income & Expense ({year})
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} barCategoryGap="30%">
          <XAxis
            dataKey="name"
            tick={{ fill: colors.axis, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: colors.axis, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => formatCurrency(v)}
          />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Bar
            dataKey="value"
            radius={[6, 6, 0, 0]}
            maxBarSize={100}
            activeBar={{ stroke: "rgba(255,255,255,0.4)", strokeWidth: 2 }}
          >
            {data.map((entry, idx) => (
              <Cell key={idx} fill={entry.color} />
            ))}
            <LabelList
              dataKey="value"
              position="top"
              formatter={(v: unknown) => formatCurrency(Number(v))}
              style={{ fill: colors.label, fontSize: 12 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
