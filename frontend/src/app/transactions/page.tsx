"use client";

import { useState, useEffect, useMemo } from "react";
import TransactionsDashboard, {
  type DashboardFetchers,
} from "@/components/transactions/TransactionsDashboard";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type PaginationState,
} from "@tanstack/react-table";
import * as Slider from "@radix-ui/react-slider";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  getTransactionsBrowse,
  getTransactionsBrowseMeta,
  getTxnDashboardMeta,
  getTxnDataHealth,
  getTxnYoySpend,
  getTxnMonthlyYoy,
  getTxnMonthlyByAccount,
  getTxnAvgByCategory,
  getTxnSubscriptions,
  getTxnCategoryTrends,
  getTxnTopBusinesses,
  getTxnUncategorized,
  getTxnHeatmap,
} from "@/lib/api";
import type { Transaction, TransactionBrowseMeta } from "@/lib/types";
import { formatCurrencyFull } from "@/lib/formatting";

// ---------------------------------------------------------------------------
// Shared filter components
// ---------------------------------------------------------------------------

function FilterSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-cj-text-faint">{label}</label>
      <select
        disabled={disabled}
        className="bg-cj-surface border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text-2 focus:outline-none focus:border-cj-border-strong disabled:opacity-40"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard fetchers
// ---------------------------------------------------------------------------

const TXN_FETCHERS: DashboardFetchers = {
  getMeta: getTxnDashboardMeta,
  getDataHealth: getTxnDataHealth,
  getYoySpend: getTxnYoySpend,
  getMonthlyYoy: getTxnMonthlyYoy,
  getMonthlyByAccount: getTxnMonthlyByAccount,
  getAvgByCategory: getTxnAvgByCategory,
  getSubscriptions: getTxnSubscriptions,
  getCategoryTrends: getTxnCategoryTrends,
  getTopBusinesses: getTxnTopBusinesses,
  getUncategorized: getTxnUncategorized,
  getHeatmap: getTxnHeatmap,
};

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

type Tab = "browse" | "dashboard";

// ---------------------------------------------------------------------------
// Column helper
// ---------------------------------------------------------------------------

const columnHelper = createColumnHelper<Transaction>();

const columns = [
  columnHelper.accessor("activity_date", { header: "Date" }),
  columnHelper.accessor("processed_description", { header: "Description" }),
  columnHelper.accessor("charged_amount", {
    header: "Amount",
    cell: (info) => {
      const row = info.row.original;
      const amount = formatCurrencyFull(info.getValue());
      return row.charged_currency && row.charged_currency !== "ILS"
        ? `${amount} (${row.charged_currency})`
        : amount;
    },
  }),
  columnHelper.accessor("category", {
    header: "Category",
    cell: (info) => info.getValue() ?? "",
  }),
  columnHelper.accessor("subcategory", {
    header: "Subcategory",
    cell: (info) => info.getValue() ?? "",
  }),
  columnHelper.accessor("account", { header: "Account" }),
  columnHelper.accessor("person", { header: "Person" }),
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TransactionsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [meta, setMeta] = useState<TransactionBrowseMeta | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [account, setAccount] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [person, setPerson] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [amountRange, setAmountRange] = useState<[number, number]>([0, 0]);

  // Table state
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });

  // Load everything once on mount
  useEffect(() => {
    Promise.all([getTransactionsBrowseMeta(), getTransactionsBrowse()]).then(
      ([m, txns]) => {
        setMeta(m);
        setDateFrom(m.date_min);
        setDateTo(m.date_max);
        setAmountRange([m.amount_min, m.amount_max]);
        setTransactions(txns);
        setLoading(false);
      }
    );
  }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset subcategory when category changes
  useEffect(() => {
    setSubcategory("");
  }, [category]);

  // Reset to first page on any filter change
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [dateFrom, dateTo, account, category, subcategory, person, search, amountRange]);

  // Subcategory options cascade off selected category
  const subcategoryOptions = useMemo(() => {
    if (!meta || !category) return [];
    return meta.subcategories_by_category[category] ?? [];
  }, [meta, category]);

  // Client-side filtering
  const filtered = useMemo(() => {
    if (!meta) return [];
    return transactions.filter((t) => {
      if (dateFrom && t.activity_date < dateFrom) return false;
      if (dateTo && t.activity_date > dateTo) return false;
      if (account && t.account !== account) return false;
      if (category && t.category !== category) return false;
      if (subcategory && t.subcategory !== subcategory) return false;
      if (person && t.person !== person) return false;
      if (
        search &&
        !t.processed_description.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      if (
        t.charged_amount < amountRange[0] ||
        t.charged_amount > amountRange[1]
      )
        return false;
      return true;
    });
  }, [
    transactions,
    meta,
    dateFrom,
    dateTo,
    account,
    category,
    subcategory,
    person,
    search,
    amountRange,
  ]);

  // Summary metrics
  const summary = useMemo(() => {
    const total = filtered.reduce((s, t) => s + t.charged_amount, 0);
    const avg = filtered.length > 0 ? total / filtered.length : 0;
    return { count: filtered.length, total, avg };
  }, [filtered]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  if (loading || !meta) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-cj-text-muted text-lg">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-cj-text">Transactions</h1>

      {/* Tabs */}
      <div className="flex border-b border-cj-border">
        {(["dashboard", "browse"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              activeTab === tab
                ? "border-red-500 text-cj-negative"
                : "border-transparent text-cj-text-faint hover:text-cj-text-3"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Dashboard tab */}
      {activeTab === "dashboard" && <TransactionsDashboard fetchers={TXN_FETCHERS} />}

      {/* Browse tab */}
      {activeTab === "browse" && (
        <div className="space-y-4">
          {/* Filter row 1: dates + account + category */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-cj-text-faint">From</label>
              <input
                type="date"
                className="bg-cj-surface border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text-2 focus:outline-none focus:border-cj-border-strong"
                value={dateFrom}
                min={meta.date_min}
                max={meta.date_max}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-cj-text-faint">To</label>
              <input
                type="date"
                className="bg-cj-surface border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text-2 focus:outline-none focus:border-cj-border-strong"
                value={dateTo}
                min={meta.date_min}
                max={meta.date_max}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <FilterSelect
              label="Account"
              value={account}
              onChange={setAccount}
              options={meta.accounts}
            />
            <FilterSelect
              label="Category"
              value={category}
              onChange={setCategory}
              options={meta.categories}
            />
          </div>

          {/* Filter row 2: subcategory + person + search + amount slider */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
            <FilterSelect
              label="Subcategory"
              value={subcategory}
              onChange={setSubcategory}
              options={subcategoryOptions}
              disabled={!category}
            />
            <FilterSelect
              label="Person"
              value={person}
              onChange={setPerson}
              options={meta.persons}
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-cj-text-faint">Search description</label>
              <input
                type="text"
                placeholder="Type to filter..."
                className="bg-cj-surface border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text-2 focus:outline-none focus:border-cj-border-strong"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs text-cj-text-faint">Amount range</label>
              <div className="flex justify-between text-xs text-cj-negative">
                <span>{formatCurrencyFull(amountRange[0])}</span>
                <span>{formatCurrencyFull(amountRange[1])}</span>
              </div>
              <Slider.Root
                className="relative flex items-center w-full h-5 select-none touch-none"
                min={meta.amount_min}
                max={meta.amount_max}
                step={1}
                value={amountRange}
                onValueChange={(v) => setAmountRange([v[0], v[1]])}
              >
                <Slider.Track className="bg-cj-hover relative grow rounded-full h-1">
                  <Slider.Range className="absolute bg-red-500 rounded-full h-full" />
                </Slider.Track>
                <Slider.Thumb className="block w-4 h-4 bg-white rounded-full shadow-md focus:outline-none focus:ring-2 focus:ring-red-500 cursor-pointer" />
                <Slider.Thumb className="block w-4 h-4 bg-white rounded-full shadow-md focus:outline-none focus:ring-2 focus:ring-red-500 cursor-pointer" />
              </Slider.Root>
            </div>
          </div>

          {/* Summary metrics */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Transactions", value: summary.count.toLocaleString() },
              { label: "Total", value: formatCurrencyFull(summary.total) },
              { label: "Average", value: formatCurrencyFull(summary.avg) },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="bg-cj-surface border border-cj-border rounded-xl px-4 py-3"
              >
                <p className="text-xs text-cj-text-faint">{label}</p>
                <p className="text-xl font-bold text-cj-text mt-1">{value}</p>
              </div>
            ))}
          </div>

          {/* Table */}
          <div className="bg-cj-surface border border-cj-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  {table.getHeaderGroups().map((hg) => (
                    <tr
                      key={hg.id}
                      className="text-xs text-cj-text-faint border-b border-cj-border"
                    >
                      {hg.headers.map((header) => (
                        <th
                          key={header.id}
                          className="px-4 py-2.5 text-left select-none cursor-pointer hover:text-cj-text-3 whitespace-nowrap"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <span className="flex items-center gap-1">
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                            {header.column.getIsSorted() === "asc" ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : header.column.getIsSorted() === "desc" ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronsUpDown className="w-3 h-3 opacity-30" />
                            )}
                          </span>
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => {
                    const uncategorized = !row.original.category;
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-cj-border/50 hover:bg-cj-elevated/30"
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            className={`px-4 py-2.5 whitespace-nowrap ${
                              uncategorized
                                ? "text-cj-text-faint italic"
                                : "text-cj-text-3"
                            }`}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {table.getRowModel().rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={columns.length}
                        className="px-4 py-10 text-center text-cj-text-faint"
                      >
                        No transactions match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-4 py-3 border-t border-cj-border flex items-center justify-between text-xs text-cj-text-faint">
              <span>
                {summary.count.toLocaleString()} results &middot; page{" "}
                {table.getState().pagination.pageIndex + 1} of{" "}
                {Math.max(table.getPageCount(), 1)}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  className="p-1.5 rounded hover:bg-cj-elevated disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  className="p-1.5 rounded hover:bg-cj-elevated disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
