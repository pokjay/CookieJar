"use client";

import React, { useRef, useState } from "react";
import { formatCurrencyFull, formatPercentage } from "@/lib/formatting";
import type { CashFlowYearly, CashFlowMonthly } from "@/lib/types";

interface CashFlowTableProps {
  title: string;
  yearlyData: CashFlowYearly[];
  onExpandYear: (year: number) => Promise<CashFlowMonthly[]>;
}

export default function CashFlowTable({
  title,
  yearlyData,
  onExpandYear,
}: CashFlowTableProps) {
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [monthlyData, setMonthlyData] = useState<CashFlowMonthly[]>([]);
  const [loading, setLoading] = useState(false);
  // Tracks the most recently requested year so a slow fetch for a year the
  // user has since collapsed (or switched away from) can't overwrite state.
  const requestedYear = useRef<number | null>(null);

  async function toggleYear(year: number) {
    if (expandedYear === year) {
      requestedYear.current = null;
      setExpandedYear(null);
      setMonthlyData([]);
      setLoading(false);
      return;
    }
    requestedYear.current = year;
    setLoading(true);
    setExpandedYear(year);
    try {
      const data = await onExpandYear(year);
      if (requestedYear.current !== year) return;
      setMonthlyData(data);
    } finally {
      // Only the still-active request may clear the spinner — a stale fetch
      // resolving after a collapse or year switch must not touch it.
      if (requestedYear.current === year) setLoading(false);
    }
  }

  const cellClass = "px-4 py-2.5 text-sm";

  return (
    <div data-testid={`cashflow-table-${title}`} className="bg-cj-surface border border-cj-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-cj-border">
        <h3 className="text-sm font-medium text-cj-text-muted">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-cj-elevated text-cj-text-muted text-xs uppercase tracking-wider">
              <th className={cellClass}>Period</th>
              <th className={`${cellClass} text-right`}>Income</th>
              <th className={`${cellClass} text-right`}>Expense</th>
              <th className={`${cellClass} text-right`}>Savings</th>
              <th className={`${cellClass} text-right`}>Savings %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cj-border">
            {yearlyData.map((row) => (
              <React.Fragment key={row.year}>
                <tr
                  data-testid={`cashflow-year-${row.year}`}
                  className="hover:bg-cj-elevated/50 cursor-pointer transition-colors"
                  onClick={() => toggleYear(row.year)}
                >
                  <td className={`${cellClass} font-medium text-cj-text-2`}>
                    <span className="mr-2 text-cj-text-faint">
                      {expandedYear === row.year ? "\u25BC" : "\u25B6"}
                    </span>
                    {row.year}
                  </td>
                  <td className={`${cellClass} text-right text-cj-positive`}>
                    {formatCurrencyFull(row.income)}
                  </td>
                  <td className={`${cellClass} text-right text-cj-negative`}>
                    {formatCurrencyFull(row.expense)}
                  </td>
                  <td
                    className={`${cellClass} text-right ${
                      row.income_expense_diff >= 0
                        ? "text-cj-positive"
                        : "text-cj-negative"
                    }`}
                  >
                    {formatCurrencyFull(row.income_expense_diff)}
                  </td>
                  <td className={`${cellClass} text-right text-cj-text-3`}>
                    {formatPercentage(row.savings_pct)}
                  </td>
                </tr>
                {expandedYear === row.year && (
                  <tr key={`${row.year}-detail`}>
                    <td colSpan={5} className="p-0">
                      {loading ? (
                        <div className="px-8 py-4 text-sm text-cj-text-faint">
                          Loading...
                        </div>
                      ) : (
                        <table className="w-full">
                          <tbody className="divide-y divide-cj-border/50">
                            {monthlyData.map((m) => (
                              <tr
                                key={m.month}
                                data-testid="cashflow-month-row"
                                className="bg-cj-elevated hover:bg-cj-elevated/30"
                              >
                                <td
                                  className={`${cellClass} pl-12 text-cj-text-muted`}
                                >
                                  {m.month_name}
                                </td>
                                <td
                                  className={`${cellClass} text-right text-cj-positive/80`}
                                >
                                  {formatCurrencyFull(m.income)}
                                </td>
                                <td
                                  className={`${cellClass} text-right text-cj-negative/80`}
                                >
                                  {formatCurrencyFull(m.expense)}
                                </td>
                                <td
                                  className={`${cellClass} text-right ${
                                    m.income_expense_diff >= 0
                                      ? "text-cj-positive/80"
                                      : "text-cj-negative/80"
                                  }`}
                                >
                                  {formatCurrencyFull(m.income_expense_diff)}
                                </td>
                                <td
                                  className={`${cellClass} text-right text-cj-text-muted`}
                                >
                                  {formatPercentage(m.savings_pct)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
