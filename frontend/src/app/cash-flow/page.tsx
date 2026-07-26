"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  getCashFlowMeta,
  getCashFlowMonthlyPage,
  getCashFlowSankey,
  getCashFlowYearlyPage,
} from "@/lib/api";
import type {
  CashFlowMeta,
  CashFlowMonthly,
  CashFlowYearly,
  SankeyData,
} from "@/lib/types";
import CashFlowSankeyChart from "@/components/CashFlowSankeyChart";
import CashFlowLedger from "@/components/ledger/CashFlowLedger";
import { Card, PillGroup, SegmentedControl } from "@/components/ledger/ui";
import { nis, nisShort, pct, signColor, MONTHS } from "@/components/ledger/format";
import { useIsCompact } from "@/components/ledger/useIsCompact";

export default function CashFlowPage() {
  const [meta, setMeta] = useState<CashFlowMeta | null>(null);
  const [year, setYear] = useState<number>(0);
  const [person, setPerson] = useState<string>("household");

  const [yearly, setYearly] = useState<CashFlowYearly[]>([]);
  const [monthly, setMonthly] = useState<CashFlowMonthly[]>([]);
  const [sankey, setSankey] = useState<SankeyData | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const compact = useIsCompact();
  const scoped = person === "household" ? undefined : person;

  useEffect(() => {
    getCashFlowMeta().then((m) => {
      setMeta(m);
      setYear(m.available_years[m.available_years.length - 1]);
    });
  }, []);

  useEffect(() => {
    setExpanded(new Set());
    setSankey(null);
  }, [year, person]);

  useEffect(() => {
    if (!year) return;
    Promise.all([
      getCashFlowYearlyPage(scoped),
      getCashFlowMonthlyPage(year, scoped),
    ]).then(([y, m]) => {
      setYearly(y);
      setMonthly(m);
      setLoading(false);
    });
  }, [year, scoped]);

  useEffect(() => {
    if (!year) return;
    getCashFlowSankey(year, scoped, [...expanded]).then(setSankey);
  }, [year, scoped, expanded]);

  const loadMonths = useCallback(
    (y: number) => getCashFlowMonthlyPage(y, scoped),
    [scoped]
  );

  const toggleCategory = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const kpis = useMemo(() => {
    if (!monthly.length) return [];
    const latest = monthly[monthly.length - 1];
    const income = monthly.reduce((s, m) => s + m.income, 0) / monthly.length;
    const expense = monthly.reduce((s, m) => s + m.expense, 0) / monthly.length;
    return [
      {
        label: `In · ${latest.month_name}`,
        value: nis(latest.income),
        color: "var(--fx-positive)",
        sub: `avg ${nis(income)} over ${monthly.length} mo`,
      },
      {
        label: `Out · ${latest.month_name}`,
        value: nis(latest.expense),
        color: "var(--fx-ink)",
        sub: "cards, bills, transfers",
      },
      {
        label: `Saved · ${latest.month_name}`,
        value: nis(latest.income_expense_diff),
        color: signColor(latest.income_expense_diff),
        sub: `${latest.savings_pct.toFixed(1)}% of income kept`,
      },
      {
        label: `Savings rate · ${year}`,
        value: pct(income ? ((income - expense) / income) * 100 : 0),
        color: signColor(income - expense),
        sub: `${nis(income - expense)} a month`,
      },
    ];
  }, [monthly, year]);

  const maxFlow = Math.max(...monthly.flatMap((m) => [m.income, m.expense]), 1);

  if (loading || !meta) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-cj-text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="fx min-h-screen">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-[22px] px-5 py-5 pb-8">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-[19px] font-semibold tracking-[-0.02em]">Cash flow</h1>
            <p className="mt-[5px] text-[12.5px] text-fx-ink-3">
              {person === "household"
                ? "Whole household · click a year to open its months"
                : `${person} only · click a year to open its months`}
            </p>
          </div>
          <div className="min-w-[8px] flex-1" />
          <SegmentedControl
            options={[
              { value: "household", label: "Household" },
              ...meta.persons.map((p) => ({ value: p, label: p })),
            ]}
            value={person}
            onChange={setPerson}
            size="sm"
            ariaLabel="Cash flow scope"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          {kpis.map((k) => (
            <Card key={k.label} className="min-w-0 flex-1 basis-[170px] !px-4 !py-[15px]">
              <div className="mb-2 text-[11.5px] text-fx-ink-2">{k.label}</div>
              <div className="fx-num text-[25px] leading-none" style={{ color: k.color }}>
                {k.value}
              </div>
              <div className="mt-2 text-[11.5px] text-fx-ink-3">{k.sub}</div>
            </Card>
          ))}
        </div>

        <Card className="!px-[18px] !pb-3.5 !pt-[18px]">
          <div className="mb-1 flex flex-wrap items-center gap-2.5">
            <span className="text-[12.5px] font-semibold">Where a year of income goes</span>
            <div className="min-w-[8px] flex-1" />
            <PillGroup
              options={meta.available_years.map((y) => ({ value: y, label: String(y) }))}
              value={year}
              onChange={setYear}
              ariaLabel="Year"
            />
          </div>
          <p className="mb-2 text-[11.5px] text-fx-ink-3">
            {expanded.size > 0
              ? `${[...expanded].join(", ")} broken out · click again to collapse`
              : "Click a category to open its subcategories"}
          </p>
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <CashFlowSankeyChart
                data={sankey}
                year={year}
                expandedCategories={expanded}
                onToggleCategory={toggleCategory}
                bare
              />
            </div>
          </div>
        </Card>

        <CashFlowLedger
          yearly={yearly}
          loadMonths={loadMonths}
          compact={compact}
          initialOpenYear={year}
        />

        <Card>
          <div className="mb-[15px] text-[12.5px] font-semibold">Monthly in / out · {year}</div>
          <div className="flex flex-col gap-2.5">
            {monthly.map((m) => (
              <div key={m.month} className="flex items-center gap-2.5">
                <span className="w-[62px] flex-none font-fx-mono text-[11px] leading-none text-fx-ink-3">
                  {MONTHS[m.month - 1] ?? m.month_name}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span
                    className="block h-2 rounded-full bg-fx-positive opacity-80"
                    style={{ width: `${(m.income / maxFlow) * 100}%` }}
                  />
                  <span
                    className="block h-2 rounded-full bg-fx-accent opacity-50"
                    style={{ width: `${(m.expense / maxFlow) * 100}%` }}
                  />
                </span>
                <span
                  className="w-[92px] flex-none text-right text-[12.5px] font-semibold"
                  style={{ color: signColor(m.income_expense_diff) }}
                >
                  {nisShort(m.income_expense_diff)}
                </span>
                {!compact && (
                  <span className="w-12 flex-none text-right text-xs text-fx-ink-3">
                    {m.savings_pct.toFixed(0)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
