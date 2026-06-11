"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getCashFlowMeta,
  getCashFlowYearlyPage,
  getCashFlowMonthlyPage,
  getCashFlowMonthlyByAccount,
  getCashFlowSankey,
} from "@/lib/api";
import type {
  CashFlowMeta,
  CashFlowYearly,
  CashFlowMonthly,
  MonthlyAccountData,
  SankeyData,
} from "@/lib/types";
import YearSelector from "@/components/YearSelector";
import PersonSelector from "@/components/PersonSelector";
import CashFlowAreaChart from "@/components/CashFlowAreaChart";
import MonthlyAccountBarChart from "@/components/MonthlyAccountBarChart";
import CashFlowSankeyChart from "@/components/CashFlowSankeyChart";
import { formatCurrencyFull } from "@/lib/formatting";
import { MONTH_NAMES } from "@/lib/constants";

function SavingsBadge({ pct }: { pct: number }) {
  const color = pct >= 20 ? "text-cj-positive" : pct >= 10 ? "text-cj-warning" : "text-cj-negative";
  return <span className={`font-medium ${color}`}>{pct.toFixed(1)}%</span>;
}

function YearlySummaryTable({ data, title }: { data: CashFlowYearly[]; title: string }) {
  return (
    <div className="bg-cj-surface border border-cj-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-cj-border">
        <h3 className="text-sm font-medium text-cj-text-3">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-cj-text-faint border-b border-cj-border">
              <th className="px-4 py-2 text-left">Year</th>
              <th className="px-4 py-2 text-right">Income</th>
              <th className="px-4 py-2 text-right">Expense</th>
              <th className="px-4 py-2 text-right">Savings</th>
              <th className="px-4 py-2 text-right">Savings %</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.year} className="border-b border-cj-border/50 hover:bg-cj-elevated/30">
                <td className="px-4 py-2.5 text-cj-text-3 font-medium">{row.year}</td>
                <td className="px-4 py-2.5 text-right text-cj-positive">{formatCurrencyFull(row.income)}</td>
                <td className="px-4 py-2.5 text-right text-cj-negative">{formatCurrencyFull(row.expense)}</td>
                <td className="px-4 py-2.5 text-right text-cj-accent-text">{formatCurrencyFull(row.savings)}</td>
                <td className="px-4 py-2.5 text-right"><SavingsBadge pct={row.savings_pct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthlyTable({ data }: { data: CashFlowMonthly[] }) {
  return (
    <div className="bg-cj-surface border border-cj-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-cj-border">
        <h3 className="text-sm font-medium text-cj-text-3">Monthly Breakdown</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-cj-text-faint border-b border-cj-border">
              <th className="px-4 py-2 text-left">Month</th>
              <th className="px-4 py-2 text-right">Income</th>
              <th className="px-4 py-2 text-right">Expense</th>
              <th className="px-4 py-2 text-right">Savings</th>
              <th className="px-4 py-2 text-right">Savings %</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.month} className="border-b border-cj-border/50 hover:bg-cj-elevated/30">
                <td className="px-4 py-2.5 text-cj-text-3">{MONTH_NAMES[row.month]}</td>
                <td className="px-4 py-2.5 text-right text-cj-positive">{formatCurrencyFull(row.income)}</td>
                <td className="px-4 py-2.5 text-right text-cj-negative">{formatCurrencyFull(row.expense)}</td>
                <td className="px-4 py-2.5 text-right text-cj-accent-text">{formatCurrencyFull(row.savings)}</td>
                <td className="px-4 py-2.5 text-right"><SavingsBadge pct={row.savings_pct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CashFlowPage() {
  const [meta, setMeta] = useState<CashFlowMeta | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(0);
  const [selectedPerson, setSelectedPerson] = useState<string>("");

  const [yearlyHousehold, setYearlyHousehold] = useState<CashFlowYearly[]>([]);
  const [yearlyPerson, setYearlyPerson] = useState<CashFlowYearly[]>([]);
  const [monthlyData, setMonthlyData] = useState<CashFlowMonthly[]>([]);
  const [accountData, setAccountData] = useState<MonthlyAccountData[]>([]);
  const [sankeyData, setSankeyData] = useState<SankeyData | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCashFlowMeta().then((m) => {
      setMeta(m);
      setSelectedYear(m.available_years[m.available_years.length - 1]);
    });
  }, []);

  // Reset Sankey state when year or person changes
  useEffect(() => {
    setExpandedCategories(new Set());
    setSankeyData(null);
  }, [selectedYear, selectedPerson]);

  const fetchData = useCallback(async () => {
    if (!selectedYear) return;
    const person = selectedPerson || undefined;
    const [household, personYearly, monthly, accounts] = await Promise.all([
      getCashFlowYearlyPage(),
      person ? getCashFlowYearlyPage(person) : Promise.resolve([]),
      getCashFlowMonthlyPage(selectedYear, person),
      getCashFlowMonthlyByAccount(selectedYear, person),
    ]);
    setYearlyHousehold(household);
    setYearlyPerson(personYearly);
    setMonthlyData(monthly);
    setAccountData(accounts);
    setLoading(false);
  }, [selectedYear, selectedPerson]);

  const fetchSankey = useCallback(async () => {
    if (!selectedYear) return;
    const person = selectedPerson || undefined;
    const expanded = Array.from(expandedCategories);
    const data = await getCashFlowSankey(selectedYear, person, expanded);
    setSankeyData(data);
  }, [selectedYear, selectedPerson, expandedCategories]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchSankey();
  }, [fetchSankey]);

  const handleToggleCategory = useCallback((name: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  if (loading || !meta) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-cj-text-muted text-lg">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-cj-text">Cash Flow</h1>
        <div className="flex items-center gap-4 flex-wrap">
          <YearSelector
            years={meta.available_years}
            value={selectedYear}
            onChange={setSelectedYear}
          />
          <PersonSelector
            persons={meta.persons}
            value={selectedPerson}
            onChange={(v) => setSelectedPerson(v as string)}
            label="Person"
          />
        </div>
      </div>

      {/* Dual-axis area chart */}
      <CashFlowAreaChart data={monthlyData} />

      {/* Sankey diagram */}
      <CashFlowSankeyChart
        data={sankeyData}
        year={selectedYear}
        expandedCategories={expandedCategories}
        onToggleCategory={handleToggleCategory}
      />

      {/* Monthly breakdown + stacked bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MonthlyTable data={monthlyData} />
        <MonthlyAccountBarChart data={accountData} />
      </div>

      {/* Yearly summary tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <YearlySummaryTable
          data={yearlyHousehold}
          title="Household — Yearly Summary"
        />
        {selectedPerson && yearlyPerson.length > 0 && (
          <YearlySummaryTable
            data={yearlyPerson}
            title={`${selectedPerson} — Yearly Summary`}
          />
        )}
      </div>
    </div>
  );
}
