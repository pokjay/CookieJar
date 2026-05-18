"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Rectangle,
} from "recharts";
import { formatCurrency, formatCurrencyFull } from "@/lib/formatting";
import type { TxnMonthlyByAccount } from "@/lib/types";
import { useThemeColors } from "@/lib/use-theme-colors";

interface Props {
  data: TxnMonthlyByAccount[];
}

const ACCOUNT_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4",
];

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

function makeRoundedTopBar(
  account: string,
  accounts: string[],
  chartData: Record<string, unknown>[]
) {
  return function RoundedTopBar(props: unknown) {
    const { x, y, width, height, month_name } = props as {
      x: number; y: number; width: number; height: number; month_name: string;
    };
    const row = chartData.find((d) => d.month_name === month_name) ?? {};
    const isTop = accounts
      .slice(accounts.indexOf(account) + 1)
      .every((a) => !row[a] || (row[a] as number) === 0);
    const radius: [number, number, number, number] = isTop ? [3, 3, 0, 0] : [0, 0, 0, 0];
    const { fill } = props as { fill: string };
    return <Rectangle x={x} y={y} width={width} height={height} radius={radius} fill={fill} />;
  };
}

const MONTH_ORDER = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function TxnMonthlyByAccountChart({ data }: Props) {
  const colors = useThemeColors();
  const accounts = [...new Set(data.map((d) => d.account))].sort();
  const monthMap = new Map<string, Record<string, number>>();
  for (const row of data) {
    if (!monthMap.has(row.month_name)) {
      monthMap.set(row.month_name, { _month: row.month } as Record<string, number>);
    }
    monthMap.get(row.month_name)![row.account] = row.spend;
  }
  const chartData = MONTH_ORDER
    .filter((m) => monthMap.has(m))
    .map((m) => ({ month_name: m, ...monthMap.get(m)! }));

  return (
    <div className="bg-cj-surface border border-cj-border rounded-xl p-6">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
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
          {accounts.map((account, i) => (
            <Bar
              key={account}
              dataKey={account}
              stackId="spend"
              fill={ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]}
              shape={makeRoundedTopBar(account, accounts, chartData)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
