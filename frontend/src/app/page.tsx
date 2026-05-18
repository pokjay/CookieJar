"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getSummary,
  getYoyChange,
  getAvgMonthly,
  getNetWorthOverTime,
  getNetWorthByCategory,
  getCashFlowYearly,
  getCashFlowMonthly,
} from "@/lib/api";
import type {
  Summary,
  YoyChange,
  AvgMonthly,
  NetWorthPoint,
  NetWorthByCategoryPoint,
  CashFlowYearly,
} from "@/lib/types";
import YearSelector from "@/components/YearSelector";
import PersonSelector from "@/components/PersonSelector";
import NetWorthMetrics from "@/components/NetWorthMetrics";
import NetWorthPieChart from "@/components/NetWorthPieChart";
import IncomeExpenseBars from "@/components/IncomeExpenseBars";
import NetWorthAreaChart from "@/components/NetWorthAreaChart";
import CategoryLineChart from "@/components/CategoryLineChart";
import CashFlowTable from "@/components/CashFlowTable";

export default function OverviewPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [yoyChange, setYoyChange] = useState<YoyChange>({});
  const [avgMonthly, setAvgMonthly] = useState<AvgMonthly | null>(null);
  const [netWorthData, setNetWorthData] = useState<NetWorthPoint[]>([]);
  const [categoryData, setCategoryData] = useState<NetWorthByCategoryPoint[]>(
    []
  );
  const [householdCashFlow, setHouseholdCashFlow] = useState<CashFlowYearly[]>(
    []
  );
  const [personCashFlow, setPersonCashFlow] = useState<CashFlowYearly[]>([]);

  const [selectedYear, setSelectedYear] = useState<number>(0);
  const [selectedPersonsArea, setSelectedPersonsArea] = useState<string[]>([]);
  const [selectedPersonCategory, setSelectedPersonCategory] =
    useState<string>("");
  const [selectedPersonCashFlow, setSelectedPersonCashFlow] =
    useState<string>("");

  const [loading, setLoading] = useState(true);

  // Initial load
  useEffect(() => {
    getSummary().then((s) => {
      setSummary(s);
      const latestYear = s.available_years[s.available_years.length - 1];
      setSelectedYear(latestYear);
      setSelectedPersonsArea(s.persons);
    });
  }, []);

  // When year changes, fetch YoY and avg monthly
  useEffect(() => {
    if (!selectedYear) return;
    Promise.all([getYoyChange(selectedYear), getAvgMonthly(selectedYear)]).then(
      ([yoy, avg]) => {
        setYoyChange(yoy);
        setAvgMonthly(avg);
      }
    );
  }, [selectedYear]);

  // Fetch net worth area chart when persons change
  useEffect(() => {
    if (!selectedPersonsArea.length) return;
    getNetWorthOverTime(selectedPersonsArea).then(setNetWorthData);
  }, [selectedPersonsArea]);

  // Fetch category line chart
  useEffect(() => {
    getNetWorthByCategory(selectedPersonCategory || undefined)
      .then(setCategoryData)
      .catch(() => setCategoryData([]));
  }, [selectedPersonCategory]);

  // Fetch cash flow tables
  const fetchCashFlow = useCallback(async () => {
    const [household, person] = await Promise.all([
      getCashFlowYearly(),
      selectedPersonCashFlow
        ? getCashFlowYearly(selectedPersonCashFlow)
        : Promise.resolve([]),
    ]);
    setHouseholdCashFlow(household);
    setPersonCashFlow(person);
    setLoading(false);
  }, [selectedPersonCashFlow]);

  useEffect(() => {
    fetchCashFlow();
  }, [fetchCashFlow]);

  if (loading || !summary) {
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
        <h1 className="text-2xl font-bold text-cj-text">Overview</h1>
        <YearSelector
          years={summary.available_years}
          value={selectedYear}
          onChange={setSelectedYear}
        />
      </div>

      {/* Net Worth Metrics */}
      <NetWorthMetrics
        total={summary.total}
        byPerson={summary.by_person}
        yoyChange={yoyChange}
      />

      {/* Pie + Bar row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <NetWorthPieChart data={summary.by_category} />
        {avgMonthly && (
          <IncomeExpenseBars
            avgIncome={avgMonthly.avg_income}
            avgExpense={avgMonthly.avg_expense}
            year={selectedYear}
          />
        )}
      </div>

      {/* Area + Line row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <PersonSelector
            persons={summary.persons}
            value={selectedPersonsArea}
            onChange={(v) => setSelectedPersonsArea(v as string[])}
            multiple
            label="Persons"
          />
          <NetWorthAreaChart
            data={netWorthData}
            persons={selectedPersonsArea}
          />
        </div>
        <div className="space-y-3">
          <PersonSelector
            persons={summary.persons}
            value={selectedPersonCategory}
            onChange={(v) => setSelectedPersonCategory(v as string)}
            label="Person"
          />
          <CategoryLineChart data={categoryData} />
        </div>
      </div>

      {/* Cash Flow Tables */}
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-cj-text-2">Cash Flow</h2>
          <PersonSelector
            persons={summary.persons}
            value={selectedPersonCashFlow}
            onChange={(v) => setSelectedPersonCashFlow(v as string)}
            label="Individual"
          />
        </div>

        <CashFlowTable
          title="Household"
          yearlyData={householdCashFlow}
          onExpandYear={(year) => getCashFlowMonthly(year)}
        />

        {selectedPersonCashFlow && personCashFlow.length > 0 && (
          <CashFlowTable
            title={selectedPersonCashFlow}
            yearlyData={personCashFlow}
            onExpandYear={(year) =>
              getCashFlowMonthly(year, selectedPersonCashFlow)
            }
          />
        )}
      </div>
    </div>
  );
}
