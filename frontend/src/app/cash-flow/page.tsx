"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
import { monthLabel, nis, nisShort, pct, signColor, MONTHS } from "@/components/ledger/format";
import { useIsCompact } from "@/components/ledger/useIsCompact";

const SANKEY_SCOPES = [
  { value: "month" as const, label: "Selected month" },
  { value: "year" as const, label: "Year" },
];

/** "2025-03" → { year: 2025, month: 3 } */
function parseMonth(key: string): { year: number; month: number } {
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}

export default function CashFlowPage() {
  const [meta, setMeta] = useState<CashFlowMeta | null>(null);
  const [monthKey, setMonthKey] = useState<string>("");
  const [person, setPerson] = useState<string>("household");

  const [yearly, setYearly] = useState<CashFlowYearly[]>([]);
  const [monthly, setMonthly] = useState<CashFlowMonthly[]>([]);
  const [sankey, setSankey] = useState<SankeyData | null>(null);
  const [sankeyScope, setSankeyScope] = useState<"month" | "year">("month");
  const [sankeyYear, setSankeyYear] = useState<number>(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const compact = useIsCompact();
  const scoped = person === "household" ? undefined : person;

  const months = meta?.available_months ?? [];
  const monthIndex = months.indexOf(monthKey);
  const { year, month } = monthKey ? parseMonth(monthKey) : { year: 0, month: 0 };

  useEffect(() => {
    getCashFlowMeta()
      .then((m) => {
        setMeta(m);
        setMonthKey(m.available_months[m.available_months.length - 1] ?? "");
        setSankeyYear(m.available_years[m.available_years.length - 1] ?? 0);
      })
      // A transient failure must land on the empty state rather than leave the
      // page spinning forever.
      .catch(() => setMeta({ persons: [], available_years: [], available_months: [] }));
  }, []);

  useEffect(() => {
    setExpanded(new Set());
    setSankey(null);
  }, [monthKey, sankeyYear, sankeyScope, person]);

  useEffect(() => {
    // Still waiting on meta; once it lands, a household with no cash flow at
    // all has no year to fetch and must fall through to the empty state.
    if (!meta) return;
    if (!year) {
      setLoading(false);
      return;
    }
    Promise.all([getCashFlowYearlyPage(scoped), getCashFlowMonthlyPage(year, scoped)])
      .then(([y, m]) => {
        setYearly(y);
        setMonthly(m);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [meta, year, scoped]);

  useEffect(() => {
    if (!year) return;
    const byMonth = sankeyScope === "month";
    getCashFlowSankey(
      byMonth ? year : sankeyYear,
      scoped,
      [...expanded],
      byMonth ? month : undefined
    ).then(setSankey);
  }, [year, month, sankeyYear, sankeyScope, scoped, expanded]);

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

  const selected = useMemo(
    () => monthly.find((m) => m.month === month) ?? null,
    [monthly, month]
  );

  const kpis = useMemo(() => {
    if (!monthly.length || !selected) return [];
    const income = monthly.reduce((s, m) => s + m.income, 0) / monthly.length;
    const expense = monthly.reduce((s, m) => s + m.expense, 0) / monthly.length;
    // A month that spends more than it earns didn't "save" anything.
    const shortfall = selected.income_expense_diff < 0;
    const deficitYear = income - expense < 0;
    return [
      {
        label: `In · ${selected.month_name}`,
        value: nis(selected.income),
        color: "var(--fx-positive)",
        sub: `avg ${nis(income)} over ${monthly.length} mo`,
      },
      {
        label: `Out · ${selected.month_name}`,
        value: nis(selected.expense),
        color: "var(--fx-ink)",
        sub: "cards, bills, transfers",
      },
      {
        label: `${shortfall ? "Overspent" : "Saved"} · ${selected.month_name}`,
        value: nis(selected.income_expense_diff),
        color: signColor(selected.income_expense_diff),
        sub: shortfall
          ? `${Math.abs(selected.savings_pct).toFixed(1)}% beyond income`
          : `${selected.savings_pct.toFixed(1)}% of income kept`,
      },
      {
        label: `${deficitYear ? "Shortfall rate" : "Savings rate"} · ${year}`,
        value: pct(income ? ((income - expense) / income) * 100 : 0),
        color: signColor(income - expense),
        sub: `${nis(income - expense)} a month`,
      },
    ];
  }, [monthly, selected, year]);

  const maxFlow = Math.max(...monthly.flatMap((m) => [m.income, m.expense]), 1);

  if (loading || !meta) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-cj-text-muted">Loading...</p>
      </div>
    );
  }

  // Every panel below is scoped to a month, so with no cash flow recorded yet
  // there is nothing to scope to. Say so instead of spinning.
  if (!monthKey) {
    return (
      <div className="fx min-h-screen">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-[22px] px-5 py-5">
          <h1 className="text-[19px] font-semibold tracking-[-0.02em]">Cash flow</h1>
          <Card>
            <p className="text-[12.5px] text-fx-ink-2">
              No cash-flow data yet. Once a sync or a manual import lands, months show up here.
            </p>
          </Card>
        </div>
      </div>
    );
  }

  const atEarliest = monthIndex <= 0;
  const atLatest = monthIndex < 0 || monthIndex >= months.length - 1;

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
          <div className="flex items-center gap-0.5 rounded-[10px] border border-fx-line bg-fx-surface-2 p-0.5">
            <button
              type="button"
              onClick={() => setMonthKey(months[monthIndex - 1])}
              disabled={atEarliest}
              aria-label="Previous month"
              className="rounded-lg px-3 py-1.5 text-fx-ink-2 disabled:cursor-default disabled:text-fx-ink-3"
            >
              <ChevronLeft size={15} />
            </button>
            <span
              data-testid="cashflow-month"
              className="min-w-[112px] text-center text-[13px] font-semibold"
            >
              {monthLabel(year, month - 1)}
            </span>
            <button
              type="button"
              onClick={() => setMonthKey(months[monthIndex + 1])}
              disabled={atLatest}
              aria-label="Next month"
              className="rounded-lg px-3 py-1.5 text-fx-ink-2 disabled:cursor-default disabled:text-fx-ink-3"
            >
              <ChevronRight size={15} />
            </button>
          </div>
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

        <CashFlowLedger
          yearly={yearly}
          loadMonths={loadMonths}
          compact={compact}
          initialOpenYear={year}
        />

        <Card>
          <div className="mb-[15px] text-[12.5px] font-semibold">Monthly in / out · {year}</div>
          <div className="flex flex-col gap-2.5">
            {monthly.map((m) => {
              const active = m.month === month;
              return (
                <button
                  key={m.month}
                  type="button"
                  onClick={() => setMonthKey(`${year}-${String(m.month).padStart(2, "0")}`)}
                  aria-pressed={active}
                  className={`flex items-center gap-2.5 rounded-[9px] px-2 py-1 text-left transition-colors ${
                    active ? "bg-fx-surface-2" : "hover:bg-fx-surface-2"
                  }`}
                >
                  <span
                    className={`w-[62px] flex-none font-fx-mono text-[11px] leading-none ${
                      active ? "text-fx-accent" : "text-fx-ink-3"
                    }`}
                  >
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
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="!px-[18px] !pb-3.5 !pt-[18px]">
          <div className="mb-1 flex flex-wrap items-center gap-2.5">
            <span className="text-[12.5px] font-semibold">
              {sankeyScope === "month"
                ? `Where ${monthLabel(year, month - 1)} income goes`
                : "Where a year of income goes"}
            </span>
            <div className="min-w-[8px] flex-1" />
            <SegmentedControl
              options={SANKEY_SCOPES}
              value={sankeyScope}
              onChange={setSankeyScope}
              size="sm"
              ariaLabel="Sankey period"
            />
            {sankeyScope === "year" && (
              <PillGroup
                options={meta.available_years.map((y) => ({ value: y, label: String(y) }))}
                value={sankeyYear}
                onChange={setSankeyYear}
                ariaLabel="Year"
              />
            )}
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
                year={sankeyScope === "month" ? year : sankeyYear}
                expandedCategories={expanded}
                onToggleCategory={toggleCategory}
                bare
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
