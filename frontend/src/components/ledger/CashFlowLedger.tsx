"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nis, signColor } from "./format";
import type { CashFlowMonthly, CashFlowYearly } from "@/lib/types";

export default function CashFlowLedger({
  yearly,
  loadMonths,
  compact,
  initialOpenYear,
}: {
  yearly: CashFlowYearly[];
  loadMonths: (year: number) => Promise<CashFlowMonthly[]>;
  compact: boolean;
  initialOpenYear?: number;
}) {
  const [openYear, setOpenYear] = useState<number | null>(initialOpenYear ?? null);
  const [months, setMonths] = useState<CashFlowMonthly[]>([]);
  const [loading, setLoading] = useState(false);
  // A slow fetch for a year the user has since collapsed must not overwrite state.
  const requested = useRef<number | null>(null);

  const open = useCallback(
    async (year: number) => {
      requested.current = year;
      setOpenYear(year);
      setLoading(true);
      try {
        const data = await loadMonths(year);
        if (requested.current === year) setMonths(data);
      } finally {
        if (requested.current === year) setLoading(false);
      }
    },
    [loadMonths]
  );

  const toggle = (year: number) => {
    if (openYear === year) {
      requested.current = null;
      setOpenYear(null);
      setMonths([]);
      setLoading(false);
      return;
    }
    open(year);
  };

  // Re-fetch when the underlying dataset changes (e.g. the person filter moved).
  useEffect(() => {
    if (openYear !== null) open(openYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMonths]);

  const amountWidth = compact ? "w-[78px]" : "w-[116px]";

  // The backend returns oldest-first; the ledger leads with the current year.
  const rows = useMemo(() => [...yearly].sort((a, b) => b.year - a.year), [yearly]);

  return (
    <div
      data-testid="cashflow-ledger"
      className="overflow-hidden rounded-fx border border-fx-card-border bg-fx-card-bg shadow-fx"
    >
      <div className="flex items-center gap-2 border-b border-fx-line px-4 py-[11px] font-fx-mono text-[9.5px] font-medium leading-none tracking-[0.08em] text-fx-ink-3">
        <span className="min-w-0 flex-1 basis-[90px]">PERIOD</span>
        <span className={`${amountWidth} flex-none text-right`}>INCOME</span>
        <span className={`${amountWidth} flex-none text-right`}>EXPENSE</span>
        <span className={`${amountWidth} flex-none text-right`}>SAVINGS</span>
        {!compact && <span className="w-[78px] flex-none text-right">SAVINGS %</span>}
      </div>

      {rows.map((row) => {
        const expanded = openYear === row.year;
        return (
          <React.Fragment key={row.year}>
            <button
              type="button"
              data-testid={`cashflow-year-${row.year}`}
              aria-expanded={expanded}
              onClick={() => toggle(row.year)}
              className={`flex w-full items-center gap-2 border-b border-fx-line-2 px-4 py-[13px] text-left ${
                expanded ? "bg-fx-accent-soft" : "hover:bg-fx-surface-2"
              }`}
            >
              <span className="flex min-w-16 flex-1 basis-[90px] items-center gap-[9px]">
                <span className="w-[9px] flex-none text-[8px] text-fx-ink-3">
                  {expanded ? "▼" : "▶"}
                </span>
                <span className="text-[13.5px] font-semibold text-fx-ink">{row.year}</span>
              </span>
              <span className={`fx-num ${amountWidth} flex-none text-right text-[13.5px] text-fx-positive`}>
                {nis(row.income)}
              </span>
              <span className={`fx-num ${amountWidth} flex-none text-right text-[13.5px] text-fx-negative`}>
                {nis(row.expense)}
              </span>
              <span
                className={`fx-num ${amountWidth} flex-none text-right text-[13.5px] font-semibold`}
                style={{ color: signColor(row.income_expense_diff) }}
              >
                {nis(row.income_expense_diff)}
              </span>
              {!compact && (
                <span className="w-[78px] flex-none text-right text-[13.5px] text-fx-ink-2">
                  {row.savings_pct.toFixed(1)}%
                </span>
              )}
            </button>

            {expanded && loading && (
              <div className="border-b border-fx-line-2 bg-fx-surface-2 px-4 py-3 text-[12.5px] text-fx-ink-3">
                Loading…
              </div>
            )}
            {expanded &&
              !loading &&
              months.map((m) => (
                <div
                  key={m.month}
                  data-testid="cashflow-month-row"
                  className="flex items-center gap-2 border-b border-fx-line-2 bg-fx-surface-2 px-4 py-2.5"
                >
                  <span className="flex min-w-16 flex-1 basis-[90px] items-center gap-[9px] pl-3.5">
                    <span className="w-[9px] flex-none" />
                    <span className="text-[12.5px] text-fx-ink-2">{m.month_name}</span>
                  </span>
                  <span className={`fx-num ${amountWidth} flex-none text-right text-[12.5px] text-fx-positive`}>
                    {nis(m.income)}
                  </span>
                  <span className={`fx-num ${amountWidth} flex-none text-right text-[12.5px] text-fx-negative`}>
                    {nis(m.expense)}
                  </span>
                  <span
                    className={`fx-num ${amountWidth} flex-none text-right text-[12.5px] font-semibold`}
                    style={{ color: signColor(m.income_expense_diff) }}
                  >
                    {nis(m.income_expense_diff)}
                  </span>
                  {!compact && (
                    <span className="w-[78px] flex-none text-right text-[12.5px] text-fx-ink-2">
                      {m.savings_pct.toFixed(1)}%
                    </span>
                  )}
                </div>
              ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}
