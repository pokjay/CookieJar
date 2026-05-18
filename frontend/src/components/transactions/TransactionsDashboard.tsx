"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type {
  TxnDashboardMeta,
  TxnDataHealth,
  TxnYoySpend,
  TxnMonthlyYoy,
  TxnMonthlyByAccount,
  TxnAvgByCategory,
  TxnSubscription,
  TxnCategoryTrend,
  TxnTopBusiness,
  TxnUncategorized,
  TxnHeatmapPoint,
} from "@/lib/types";
import YearSelector from "@/components/YearSelector";
import { formatCurrencyFull, formatPercentage } from "@/lib/formatting";
import YoyTotalBarChart from "@/components/transactions/YoyTotalBarChart";
import MonthlyYoyChart from "@/components/transactions/MonthlyYoyChart";
import TxnMonthlyByAccountChart from "@/components/transactions/TxnMonthlyByAccountChart";
import AvgByCategoryChart from "@/components/transactions/AvgByCategoryChart";
import CategoryTrendsGrid from "@/components/transactions/CategoryTrendsGrid";
import TopBusinessesChart from "@/components/transactions/TopBusinessesChart";
import SpendingHeatmap from "@/components/transactions/SpendingHeatmap";

// ---------------------------------------------------------------------------
// Fetchers interface — injected by callers so this component is reusable
// ---------------------------------------------------------------------------

export interface DashboardFetchers {
  getMeta: () => Promise<TxnDashboardMeta>;
  getDataHealth: (year: number) => Promise<TxnDataHealth>;
  getYoySpend: () => Promise<TxnYoySpend[]>;
  getMonthlyYoy: (year: number) => Promise<TxnMonthlyYoy[]>;
  getMonthlyByAccount: (year: number) => Promise<TxnMonthlyByAccount[]>;
  getAvgByCategory: (year: number) => Promise<TxnAvgByCategory[]>;
  getSubscriptions?: (year: number) => Promise<TxnSubscription[]>;
  getCategoryTrends: (year: number) => Promise<TxnCategoryTrend[]>;
  getTopBusinesses: (year: number) => Promise<TxnTopBusiness[]>;
  getUncategorized?: (year: number) => Promise<TxnUncategorized[]>;
  getHeatmap: (year: number) => Promise<TxnHeatmapPoint[]>;
}

// ---------------------------------------------------------------------------
// Data Health Row
// ---------------------------------------------------------------------------

function DataHealthRow({ health, year }: { health: TxnDataHealth; year: number }) {
  const metrics = [
    { label: "Last Transaction", value: health.last_transaction_date ?? "N/A" },
    { label: "Uncategorized", value: String(health.uncategorized_count) },
    { label: "Uncategorized %", value: formatPercentage(health.uncategorized_pct) },
    { label: `Total Spend (${year})`, value: formatCurrencyFull(health.total_spend) },
  ];

  return (
    <section>
      <h2 className="text-base font-semibold text-cj-text-3 mb-3">Data Health</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="bg-cj-surface border border-cj-border rounded-xl px-4 py-4"
          >
            <p className="text-xs text-cj-text-faint mb-1">{m.label}</p>
            <p className="text-lg font-semibold text-cj-text">{m.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Subscriptions Table
// ---------------------------------------------------------------------------

function SubscriptionsTable({ data }: { data: TxnSubscription[] }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-cj-text-3 mb-3">
        Recurring Charges
      </h2>
      {data.length === 0 ? (
        <p className="text-sm text-cj-text-faint">No recurring charges detected.</p>
      ) : (
        <div className="bg-cj-surface border border-cj-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-cj-text-faint border-b border-cj-border">
                  <th className="px-4 py-2 text-left">Description</th>
                  <th className="px-4 py-2 text-right">Max Amount</th>
                  <th className="px-4 py-2 text-right">Occurrences</th>
                  <th className="px-4 py-2 text-right">Total Spend</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr
                    key={row.name}
                    className="border-b border-cj-border/50 hover:bg-cj-elevated/30"
                  >
                    <td className="px-4 py-2.5 text-cj-text-2">{row.name}</td>
                    <td className="px-4 py-2.5 text-right text-cj-accent-text">
                      {formatCurrencyFull(row.max_amount)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-cj-text-3">
                      {row.total_charges}
                    </td>
                    <td className="px-4 py-2.5 text-right text-cj-positive">
                      {formatCurrencyFull(row.total_spend)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Uncategorized Table
// ---------------------------------------------------------------------------

const UNCAT_PAGE_SIZE = 10;

function UncategorizedTable({ data }: { data: TxnUncategorized[] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(data.length / UNCAT_PAGE_SIZE);
  const rows = data.slice(page * UNCAT_PAGE_SIZE, (page + 1) * UNCAT_PAGE_SIZE);

  if (data.length === 0) return null;
  return (
    <section>
      <h2 className="text-base font-semibold text-cj-text-3 mb-3">
        Uncategorized Transactions
      </h2>
      <div className="bg-cj-surface border border-cj-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-cj-text-faint border-b border-cj-border">
                <th className="px-4 py-2 text-left">Description</th>
                <th className="px-4 py-2 text-right">Count</th>
                <th className="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.description}
                  className="border-b border-cj-border/50 hover:bg-cj-elevated/30"
                >
                  <td className="px-4 py-2.5 text-cj-text-2">{row.description}</td>
                  <td className="px-4 py-2.5 text-right text-cj-text-muted">{row.count}</td>
                  <td className="px-4 py-2.5 text-right text-cj-negative">
                    {formatCurrencyFull(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div className="px-4 py-3 border-t border-cj-border flex items-center justify-between text-xs text-cj-text-faint">
            <span>
              {data.length} total &middot; page {page + 1} of {pageCount}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 0}
                className="p-1.5 rounded hover:bg-cj-elevated disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= pageCount - 1}
                className="p-1.5 rounded hover:bg-cj-elevated disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

interface Props {
  fetchers: DashboardFetchers;
  groupByLabel?: string;
}

export default function TransactionsDashboard({
  fetchers,
  groupByLabel = "Category",
}: Props) {
  const [meta, setMeta] = useState<TxnDashboardMeta | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(0);

  const [health, setHealth] = useState<TxnDataHealth | null>(null);
  const [yoySpend, setYoySpend] = useState<TxnYoySpend[]>([]);
  const [monthlyYoy, setMonthlyYoy] = useState<TxnMonthlyYoy[]>([]);
  const [monthlyByAccount, setMonthlyByAccount] = useState<TxnMonthlyByAccount[]>([]);
  const [avgByCategory, setAvgByCategory] = useState<TxnAvgByCategory[]>([]);
  const [subscriptions, setSubscriptions] = useState<TxnSubscription[]>([]);
  const [categoryTrends, setCategoryTrends] = useState<TxnCategoryTrend[]>([]);
  const [topBusinesses, setTopBusinesses] = useState<TxnTopBusiness[]>([]);
  const [uncategorized, setUncategorized] = useState<TxnUncategorized[]>([]);
  const [heatmap, setHeatmap] = useState<TxnHeatmapPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchers.getMeta().then((m) => {
      setMeta(m);
      if (m.available_years.length > 0) {
        setSelectedYear(m.available_years[m.available_years.length - 1]);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!meta) return;
    fetchers.getYoySpend().then(setYoySpend);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  const fetchYearData = useCallback(async () => {
    if (!selectedYear) return;
    setLoading(true);
    const yearFetches: Promise<unknown>[] = [
      fetchers.getDataHealth(selectedYear).then(setHealth),
      fetchers.getMonthlyYoy(selectedYear).then(setMonthlyYoy),
      fetchers.getMonthlyByAccount(selectedYear).then(setMonthlyByAccount),
      fetchers.getAvgByCategory(selectedYear).then(setAvgByCategory),
      fetchers.getCategoryTrends(selectedYear).then(setCategoryTrends),
      fetchers.getTopBusinesses(selectedYear).then(setTopBusinesses),
      fetchers.getHeatmap(selectedYear).then(setHeatmap),
    ];
    if (fetchers.getSubscriptions) {
      yearFetches.push(fetchers.getSubscriptions(selectedYear).then(setSubscriptions));
    }
    if (fetchers.getUncategorized) {
      yearFetches.push(fetchers.getUncategorized(selectedYear).then(setUncategorized));
    }
    await Promise.all(yearFetches);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear]);

  useEffect(() => {
    fetchYearData();
  }, [fetchYearData]);

  if (!meta) {
    return (
      <div className="min-h-64 flex items-center justify-center">
        <p className="text-cj-text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <YearSelector
          years={meta.available_years}
          value={selectedYear}
          onChange={setSelectedYear}
        />
      </div>

      {loading && (
        <div className="min-h-32 flex items-center justify-center">
          <p className="text-cj-text-muted text-sm">Loading data...</p>
        </div>
      )}

      {!loading && health && (
        <>
          <DataHealthRow health={health} year={selectedYear} />

          <section>
            <h2 className="text-base font-semibold text-cj-text-3 mb-3">
              Total Spend by Year
            </h2>
            <YoyTotalBarChart data={yoySpend} />
          </section>

          <section>
            <h2 className="text-base font-semibold text-cj-text-3 mb-3">
              Monthly Spend — Year-over-Year
            </h2>
            <MonthlyYoyChart data={monthlyYoy} />
          </section>

          <section>
            <h2 className="text-base font-semibold text-cj-text-3 mb-3">
              Monthly Spend by Account ({selectedYear})
            </h2>
            <TxnMonthlyByAccountChart data={monthlyByAccount} />
          </section>

          <section>
            <h2 className="text-base font-semibold text-cj-text-3 mb-3">
              Avg Monthly Spend by {groupByLabel} ({selectedYear})
            </h2>
            <AvgByCategoryChart data={avgByCategory} />
          </section>

          {fetchers.getSubscriptions && (
            <SubscriptionsTable data={subscriptions} />
          )}

          <section>
            <h2 className="text-base font-semibold text-cj-text-3 mb-3">
              {groupByLabel} Trends ({selectedYear})
            </h2>
            <CategoryTrendsGrid data={categoryTrends} />
          </section>

          <section>
            <h2 className="text-base font-semibold text-cj-text-3 mb-3">
              Top 15 Businesses ({selectedYear})
            </h2>
            <TopBusinessesChart data={topBusinesses} />
          </section>

          {fetchers.getUncategorized && (
            <UncategorizedTable data={uncategorized} />
          )}

          <section>
            <h2 className="text-base font-semibold text-cj-text-3 mb-3">
              Spending Heatmap — {groupByLabel} × Day of Week ({selectedYear})
            </h2>
            <SpendingHeatmap data={heatmap} />
          </section>
        </>
      )}
    </div>
  );
}
