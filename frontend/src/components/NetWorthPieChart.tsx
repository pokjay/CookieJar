"use client";

import { useEffect, useRef, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { CATEGORY_COLORS } from "@/lib/constants";
import { formatCurrency, formatCurrencyFull } from "@/lib/formatting";
import { useThemeColors } from "@/lib/use-theme-colors";

interface NetWorthPieChartProps {
  data: Record<string, number>;
}

interface PieEntry {
  name: string;
  value: number;
}

const RADIAN = Math.PI / 180;

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div className="bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm">
      <p className="text-cj-text-3">{name}</p>
      <p className="text-cj-text font-medium">{formatCurrencyFull(value)}</p>
    </div>
  );
}

export default function NetWorthPieChart({ data }: NetWorthPieChartProps) {
  const colors = useThemeColors();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const isMobile = containerWidth < 480;

  const chartData: PieEntry[] = Object.entries(data).map(([name, value]) => ({
    name,
    value,
  }));

  function renderLabel({
    cx, cy, midAngle, outerRadius, name, value, fill,
  }: {
    cx?: number; cy?: number; midAngle?: number; outerRadius?: number;
    name?: string; value?: number; fill?: string;
  }) {
    if (cx === undefined || cy === undefined || midAngle === undefined || outerRadius === undefined || value === undefined) return null;
    const radius = outerRadius + 44;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    const anchor = x > cx ? "start" : "end";
    const nudge = x > cx ? 6 : -6;
    return (
      <g>
        <text x={x + nudge} y={y - 5} textAnchor={anchor} fill={fill} fontSize={12} fontWeight={500}>
          {name}
        </text>
        <text x={x + nudge} y={y + 11} textAnchor={anchor} fill={colors.axis} fontSize={11}>
          {formatCurrency(value)}
        </text>
      </g>
    );
  }

  return (
    <div data-testid="chart-pie" ref={containerRef} className="bg-cj-surface border border-cj-border rounded-xl p-6">
      <h3 className="text-sm font-medium text-cj-text-muted mb-4">
        Net Worth by Category
      </h3>
      <ResponsiveContainer width="100%" height={320}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius="52%"
            outerRadius="68%"
            dataKey="value"
            nameKey="name"
            label={isMobile ? undefined : renderLabel}
            labelLine={isMobile ? false : { stroke: colors.grid, strokeWidth: 1 }}
          >
            {chartData.map((entry) => (
              <Cell
                key={entry.name}
                fill={CATEGORY_COLORS[entry.name] || "#6B7280"}
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      {isMobile && (
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          {chartData.map((entry) => (
            <div key={entry.name} className="flex items-center gap-2 min-w-0">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: CATEGORY_COLORS[entry.name] || "#6B7280" }}
              />
              <div className="min-w-0">
                <p className="text-xs font-medium text-cj-text truncate">{entry.name}</p>
                <p className="text-xs text-cj-text-muted">{formatCurrency(entry.value)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
