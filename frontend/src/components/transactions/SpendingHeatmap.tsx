"use client";

import { useTheme } from "next-themes";
import { formatCurrencyFull } from "@/lib/formatting";
import type { TxnHeatmapPoint } from "@/lib/types";

interface Props {
  data: TxnHeatmapPoint[];
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function cellColor(value: number, max: number, isDark: boolean): string {
  if (max === 0 || value === 0) return "bg-cj-elevated";
  const intensity = value / max;
  if (isDark) {
    if (intensity < 0.2) return "bg-cj-accent/20";
    if (intensity < 0.4) return "bg-cj-accent/40";
    if (intensity < 0.6) return "bg-cj-accent/60";
    if (intensity < 0.8) return "bg-cj-accent/80";
    return "bg-cj-accent";
  } else {
    if (intensity < 0.2) return "bg-cj-accent/15";
    if (intensity < 0.4) return "bg-cj-accent/30";
    if (intensity < 0.6) return "bg-cj-accent/50";
    if (intensity < 0.8) return "bg-cj-accent/70";
    return "bg-cj-accent/90";
  }
}

export default function SpendingHeatmap({ data }: Props) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  if (data.length === 0) return null;

  const categories = [...new Set(data.map((d) => d.category))].sort();
  const lookup = new Map<string, number>();
  for (const row of data) {
    lookup.set(`${row.category}|${row.dow}`, row.spend);
  }
  const maxSpend = Math.max(...data.map((d) => d.spend), 1);

  return (
    <div className="bg-cj-surface border border-cj-border rounded-xl p-6 overflow-x-auto">
      <table className="w-full text-xs border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="text-left text-cj-text-faint font-normal px-2 py-1 w-32">
              Category
            </th>
            {DAYS.map((d) => (
              <th
                key={d}
                className="text-center text-cj-text-faint font-normal px-2 py-1 min-w-[60px]"
              >
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => (
            <tr key={cat}>
              <td className="text-cj-text-3 px-2 py-1 whitespace-nowrap">{cat}</td>
              {DAYS.map((_, dow) => {
                const spend = lookup.get(`${cat}|${dow}`) ?? 0;
                return (
                  <td key={dow} className="px-1 py-0.5">
                    <div
                      className={`rounded h-8 flex items-center justify-center ${cellColor(spend, maxSpend, isDark)}`}
                      title={`${cat} / ${DAYS[dow]}: ${formatCurrencyFull(spend)}`}
                    >
                      {spend > 0 && (
                        <span className="text-cj-text/80 text-[10px]">
                          {spend >= 1000
                            ? `${(spend / 1000).toFixed(0)}K`
                            : spend.toFixed(0)}
                        </span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
