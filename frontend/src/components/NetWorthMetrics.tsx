"use client";

import { formatCurrencyFull, formatDelta } from "@/lib/formatting";
import type { YoyChange } from "@/lib/types";

interface NetWorthMetricsProps {
  total: number;
  byPerson: Record<string, number>;
  yoyChange: YoyChange;
}

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-cj-text-faint">N/A</span>;
  }
  const isPositive = value > 0;
  return (
    <span
      className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
        isPositive
          ? "bg-cj-positive/10 text-cj-positive"
          : "bg-cj-negative/10 text-cj-negative"
      }`}
    >
      {formatDelta(value)}
    </span>
  );
}

export default function NetWorthMetrics({
  total,
  byPerson,
  yoyChange,
}: NetWorthMetricsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div data-testid="metric-total">
        <div className="bg-cj-surface border border-cj-border rounded-xl p-6">
          <p className="text-sm text-cj-text-muted">Total Net Worth</p>
          <p data-testid="metric-total-value" className="text-2xl font-bold text-cj-text mt-1">
            {formatCurrencyFull(total)}
          </p>
          <div className="mt-2">
            <span data-testid="delta-Overall"><DeltaBadge value={yoyChange["Overall"] ?? null} /></span>
            <span className="text-xs text-cj-text-faint ml-2">YoY</span>
          </div>
        </div>
      </div>
      {Object.entries(byPerson).map(([person, amount]) => (
        <div key={person} data-testid={`metric-${person}`}>
          <div className="bg-cj-surface border border-cj-border rounded-xl p-6">
            <p className="text-sm text-cj-text-muted">{person}</p>
            <p data-testid={`metric-${person}-value`} className="text-2xl font-bold text-cj-text mt-1">
              {formatCurrencyFull(amount)}
            </p>
            <div className="mt-2">
              <span data-testid={`delta-${person}`}><DeltaBadge value={yoyChange[person] ?? null} /></span>
              <span className="text-xs text-cj-text-faint ml-2">YoY</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
