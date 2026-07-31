"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  getAccountsOverTime,
  getCashFlowMeta,
  getCashFlowMonthly,
  getCashFlowYearly,
  getTxnCategoryTrends,
} from "@/lib/api";
import type {
  AccountBalancePoint,
  CashFlowYearly,
  ChartSeries,
  RangeKey,
  TxnCategoryTrend,
} from "@/lib/types";
import InteractiveChart from "@/components/ledger/InteractiveChart";
import CashFlowLedger from "@/components/ledger/CashFlowLedger";
import {
  PillGroup,
  SectionHeader,
  SegmentedControl,
  Sparkline,
} from "@/components/ledger/ui";
import {
  categoryColor,
  monthLabelShort,
  nis,
  nisShort,
  pct,
  signColor,
} from "@/components/ledger/format";
import { paddedExtent } from "@/components/ledger/paths";
import { useIsCompact } from "@/components/ledger/useIsCompact";
import AccountsByPerson from "@/components/overview/AccountsByPerson";
import {
  accountTypeColor,
  buildAccountsData,
  groupByCategory,
  orderByAccountType,
  rangeStart,
} from "@/components/overview/accounts";
import { keyToYearMonth } from "@/components/spending/model";

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "YTD", label: "YTD" },
  { value: "1Y", label: "1Y" },
  { value: "3Y", label: "3Y" },
  { value: "5Y", label: "5Y" },
  { value: "ALL", label: "All" },
];

const RANGE_LABELS: Record<RangeKey, string> = {
  "1M": "1 mo",
  "3M": "3 mo",
  "6M": "6 mo",
  YTD: "YTD",
  "1Y": "12 mo",
  "3Y": "3 yr",
  "5Y": "5 yr",
  ALL: "all time",
};

const MODE_OPTIONS = [
  { value: "total" as const, label: "Total" },
  { value: "type" as const, label: "By type" },
];

const GROUP_BY_OPTIONS = [
  { value: "type" as const, label: "By type" },
  { value: "account" as const, label: "By account" },
];

export default function OverviewPage() {
  const [points, setPoints] = useState<AccountBalancePoint[]>([]);
  const [yearly, setYearly] = useState<CashFlowYearly[]>([]);
  const [persons, setPersons] = useState<string[]>([]);
  const [trends, setTrends] = useState<TxnCategoryTrend[]>([]);
  const [loading, setLoading] = useState(true);

  const [range, setRange] = useState<RangeKey>("1Y");
  const [mode, setMode] = useState<"total" | "type">("total");
  const [cashFlowPerson, setCashFlowPerson] = useState<string>("household");
  const [groupBy, setGroupBy] = useState<"type" | "account">("type");

  const compact = useIsCompact();

  useEffect(() => {
    Promise.all([getAccountsOverTime(), getCashFlowMeta()])
      .then(([accounts, meta]) => {
        setPoints(accounts);
        setPersons(meta.persons);
        const latestYear = meta.available_years[meta.available_years.length - 1];
        if (latestYear) {
          getTxnCategoryTrends(latestYear).then(setTrends).catch(() => setTrends([]));
        }
      })
      // A transient network/backend error must still drop the loading screen,
      // otherwise the page hangs on it forever. Render with whatever loaded.
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const person = cashFlowPerson === "household" ? undefined : cashFlowPerson;
    getCashFlowYearly(person).then(setYearly);
  }, [cashFlowPerson]);

  const loadMonths = useCallback(
    (year: number) =>
      getCashFlowMonthly(year, cashFlowPerson === "household" ? undefined : cashFlowPerson),
    [cashFlowPerson]
  );

  const data = useMemo(() => buildAccountsData(points), [points]);
  const start = useMemo(() => rangeStart(range, data.monthKeys), [range, data.monthKeys]);

  // Household totals per account type, in a fixed bottom-to-top stack order.
  const types = useMemo(
    () => orderByAccountType(groupByCategory(data.accounts, data.monthKeys.length)),
    [data]
  );

  const spending = useMemo(() => {
    if (!trends.length) return [];
    const latestMonth = Math.max(...trends.map((t) => t.month));
    const byCategory = new Map<string, Map<number, number>>();
    for (const t of trends) {
      if (!byCategory.has(t.category)) byCategory.set(t.category, new Map());
      byCategory.get(t.category)!.set(t.month, t.spend);
    }
    return [...byCategory.entries()]
      .map(([name, months]) => {
        const amount = months.get(latestMonth) ?? 0;
        const prior = [1, 2, 3].map((n) => months.get(latestMonth - n) ?? 0);
        const average = prior.reduce((s, v) => s + v, 0) / 3;
        const series = Array.from({ length: latestMonth }, (_, i) => months.get(i + 1) ?? 0);
        return {
          name,
          amount,
          change: average ? ((amount - average) / average) * 100 : 0,
          series,
          monthCount: latestMonth,
        };
      })
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 4);
  }, [trends]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-cj-text-muted">Loading...</p>
      </div>
    );
  }

  const total = data.total.slice(start);
  const invested = data.invested.slice(start);
  const labels = data.monthKeys.slice(start).map((k) => {
    const { year, month } = keyToYearMonth(k);
    return monthLabelShort(year, month);
  });

  const byType = mode === "type";
  const netWorth = total[total.length - 1] ?? 0;
  const first = total[0] ?? 0;
  const change = netWorth - first;

  // Each band is drawn as a running total, so the top edge of the stack is the
  // net-worth line itself and the bands read as shares of it.
  const bands = types.map((t) => t.values.slice(start));
  const cumulative = bands.map((values, i) =>
    values.map((v, j) => v + (i ? bands.slice(0, i).reduce((s, b) => s + b[j], 0) : 0))
  );

  // Stacked areas only read correctly against a zero baseline; the single line
  // can zoom into its own range.
  const [lo, hi] = byType
    ? [0, Math.max(...total, 1) * 1.06]
    : paddedExtent(total);

  const series: ChartSeries[] = byType
    ? types.map((t, i) => ({
        label: t.category,
        values: cumulative[i],
        baseline: i ? cumulative[i - 1] : undefined,
        color: accountTypeColor(t.category),
        fillColor: accountTypeColor(t.category),
        width: 1.6,
      }))
    : [{ label: "Net worth", values: total, color: "var(--fx-accent)", width: 2.2, fill: true }];

  const step = Math.max(1, Math.round(labels.length / (compact ? 4 : 6)));
  const axisLabels = labels.filter((_, i) => i % step === 0);
  if (labels.length && axisLabels[axisLabels.length - 1] !== labels[labels.length - 1]) {
    axisLabels.push(labels[labels.length - 1]);
  }

  return (
    <div className="fx min-h-screen">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-[34px] pb-[34px] pt-[22px]">
        {/* Hero */}
        <div>
          <div className="px-5">
            <div className="flex flex-wrap items-end gap-x-7 gap-y-4">
              <div className="min-w-0 flex-1 basis-[250px]">
                <div className="font-fx-mono text-[10px] font-medium leading-none tracking-[0.14em] text-fx-ink-3">
                  {byType ? "HOUSEHOLD NET WORTH · BY ACCOUNT TYPE" : "HOUSEHOLD NET WORTH"}
                </div>
                <div
                  data-testid="metric-total-value"
                  className={`fx-num mt-3.5 leading-none text-fx-ink ${
                    compact ? "text-[40px]" : "text-[50px]"
                  }`}
                >
                  {nis(netWorth)}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-[9px]">
                  <span
                    className="text-[13px] font-semibold"
                    style={{ color: signColor(change) }}
                  >
                    {pct(first ? (change / Math.abs(first)) * 100 : 0)}
                  </span>
                  <span className="text-[12.5px] text-fx-ink-2">
                    {nisShort(change)} since {labels[0]}
                  </span>
                </div>
              </div>
              <SegmentedControl
                options={MODE_OPTIONS}
                value={mode}
                onChange={setMode}
                ariaLabel="Net worth view"
              />
            </div>
          </div>

          <div className="mt-4" data-testid="chart-networth">
            <InteractiveChart
              series={series}
              height={compact ? 200 : 300}
              min={lo}
              max={hi}
              pointCount={total.length}
              markerSeries={series.length - 1}
              ariaLabel={
                byType
                  ? "Household net worth over time, stacked by account type"
                  : "Household net worth over time"
              }
              tooltipTitle={(i) => labels[i]}
              tooltipRows={(i) =>
                byType
                  ? [
                      // Top band first, so the rows read in the order they're drawn.
                      ...[...types]
                        .reverse()
                        .map((t) => ({
                          label: t.category,
                          value: nis(t.values[start + i] ?? 0),
                          color: accountTypeColor(t.category),
                        })),
                      { label: "Net worth", value: nis(total[i]), color: "transparent" },
                    ]
                  : [
                      { label: "Net worth", value: nis(total[i]), color: "var(--fx-accent)" },
                      {
                        label: i > 0 ? "Change on month" : "Start of range",
                        value: i > 0 ? nisShort(total[i] - total[i - 1]) : "—",
                        color: "transparent",
                      },
                    ]
              }
            />
          </div>

          <div className="mt-[9px] flex justify-between px-5 font-fx-mono text-[10.5px] leading-none text-fx-ink-3">
            {axisLabels.map((l, i) => (
              <span key={`${l}-${i}`}>{l}</span>
            ))}
          </div>

          {byType && (
            <div className="mt-3.5 flex flex-wrap gap-x-[18px] gap-y-2 px-5">
              {[...types].reverse().map((t) => (
                <span
                  key={t.category}
                  data-testid={`chart-legend-${t.category}`}
                  className="flex items-center gap-[7px] text-[11.5px]"
                >
                  <span
                    className="h-2 w-2 flex-none rounded-sm"
                    style={{ background: accountTypeColor(t.category) }}
                  />
                  <span className="text-fx-ink-2">{t.category}</span>
                  <span className="fx-num text-fx-ink">{nisShort(t.balance)}</span>
                </span>
              ))}
            </div>
          )}

          <div className="mt-3.5 px-5">
            <PillGroup
              options={RANGE_OPTIONS}
              value={range}
              onChange={setRange}
              ariaLabel="Time range"
            />
          </div>

          <p className="mx-5 mt-4 text-sm leading-[1.6] text-fx-ink-2 text-pretty">
            Net worth is {nis(netWorth)}, {pct(first ? (change / Math.abs(first)) * 100 : 0)}{" "}
            {range === "ALL" ? "over all time" : `over the last ${RANGE_LABELS[range]}`}. Long-term
            holdings account for{" "}
            {nis(invested[invested.length - 1] ?? 0)} of it — {""}
            {Math.round(((invested[invested.length - 1] ?? 0) / (netWorth || 1)) * 100)}% of the
            total.
          </p>
        </div>

        {/* Accounts */}
        <div className="px-5">
          <SectionHeader
            label="ACCOUNTS"
            trailing={
              <SegmentedControl
                options={GROUP_BY_OPTIONS}
                value={groupBy}
                onChange={setGroupBy}
                size="sm"
                ariaLabel="Accounts grouping"
              />
            }
          />
          <AccountsByPerson
            data={data}
            start={start}
            rangeLabel={RANGE_LABELS[range]}
            compact={compact}
            groupBy={groupBy}
          />
          <p className="mt-[9px] text-[11.5px] text-fx-ink-3">
            {data.accounts.length} accounts · {RANGE_LABELS[range]} · tap a person, then{" "}
            {groupBy === "type" ? "a type" : "an account"}
          </p>
        </div>

        {/* Cash flow */}
        <div className="px-5">
          <SectionHeader
            label="CASH FLOW"
            trailing={
              <SegmentedControl
                options={[
                  { value: "household", label: "Household" },
                  ...persons.map((p) => ({ value: p, label: p })),
                ]}
                value={cashFlowPerson}
                onChange={setCashFlowPerson}
                size="sm"
                ariaLabel="Cash flow scope"
              />
            }
          />
          <CashFlowLedger yearly={yearly} loadMonths={loadMonths} compact={compact} />
          <p className="mt-[9px] text-[11.5px] text-fx-ink-3">
            {cashFlowPerson === "household"
              ? "Whole household · click a year to open its months"
              : `${cashFlowPerson} only · click a year to open its months`}
          </p>
        </div>

        {/* Spending strip */}
        {spending.length > 0 && (
          <div className="px-5">
            <SectionHeader
              label="SPENDING"
              trailing={
                <Link href="/transactions" className="text-[11.5px] text-fx-accent">
                  All spending →
                </Link>
              }
            />
            <div className="flex flex-wrap gap-3">
              {spending.map((c, i) => (
                <Link
                  key={c.name}
                  href={`/transactions?category=${encodeURIComponent(c.name)}`}
                  className="min-w-0 flex-1 basis-[190px] rounded-fx border border-fx-card-border bg-fx-card-bg px-4 py-[15px] shadow-fx"
                >
                  <div className="flex items-center gap-[7px] font-fx-mono text-[9.5px] font-medium leading-none tracking-[0.08em] text-fx-ink-3">
                    <span
                      className="h-1.5 w-1.5 rounded-sm"
                      style={{ background: categoryColor(c.name) }}
                    />
                    #{i + 1}
                  </div>
                  <div className="mt-[9px] truncate text-[12.5px] font-semibold text-fx-ink">
                    {c.name}
                  </div>
                  <div className="fx-num mt-1.5 text-[23px] text-fx-ink">{nis(c.amount)}</div>
                  <Sparkline
                    values={c.series}
                    color={categoryColor(c.name)}
                    height={28}
                    className="mt-2.5"
                  />
                  <div className="mt-[7px] flex justify-between text-[11px] text-fx-ink-3">
                    <span>{c.monthCount} mo</span>
                    <span
                      className="font-semibold"
                      style={{ color: signColor(c.change, "down") }}
                    >
                      {pct(c.change)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
