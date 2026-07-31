import type { Transaction } from "@/lib/types";
import { daysInMonth } from "@/components/ledger/format";

export const UNCATEGORIZED = "Uncategorized";

export interface SpendMonth {
  /** year * 12 + month, so month arithmetic is plain integer arithmetic. */
  key: number;
  year: number;
  month: number;
  days: number;
  txns: Transaction[];
  total: number;
  /** Cumulative spend by day-of-month, length = days in month. */
  cumulative: number[];
}

export interface SpendingModel {
  months: SpendMonth[];
  byKey: Map<number, SpendMonth>;
  /** Latest month that has any transaction. */
  latestKey: number;
  /** Day-of-month the data stops at for the latest month; full length otherwise. */
  coverageDay: (key: number) => number;
  totalThrough: (key: number, day: number) => number;
  categoryTotalsThrough: (key: number, day: number) => Map<string, number>;
  categoryTotal: (key: number, category: string) => number;
  categories: string[];
}

export function categoryOf(t: Transaction): string {
  return t.category ?? UNCATEGORIZED;
}

export function monthKey(dateIso: string): number {
  const year = Number(dateIso.slice(0, 4));
  const month = Number(dateIso.slice(5, 7)) - 1;
  return year * 12 + month;
}

export function keyToYearMonth(key: number): { year: number; month: number } {
  return { year: Math.floor(key / 12), month: ((key % 12) + 12) % 12 };
}

export function buildSpendingModel(transactions: Transaction[]): SpendingModel {
  const byKey = new Map<number, SpendMonth>();

  for (const t of transactions) {
    const key = monthKey(t.activity_date);
    let m = byKey.get(key);
    if (!m) {
      const { year, month } = keyToYearMonth(key);
      const days = daysInMonth(year, month);
      m = { key, year, month, days, txns: [], total: 0, cumulative: new Array(days).fill(0) };
      byKey.set(key, m);
    }
    m.txns.push(t);
    m.total += t.charged_amount;
    const day = Number(t.activity_date.slice(8, 10));
    if (day >= 1 && day <= m.days) m.cumulative[day - 1] += t.charged_amount;
  }

  for (const m of byKey.values()) {
    m.txns.sort(
      (a, b) => b.activity_date.localeCompare(a.activity_date) || b.charged_amount - a.charged_amount
    );
    let running = 0;
    m.cumulative = m.cumulative.map((v) => (running += v));
  }

  const months = [...byKey.values()].sort((a, b) => a.key - b.key);
  const latestKey = months.length ? months[months.length - 1].key : 0;

  // The newest month is usually partial; comparisons must stop at the same day.
  const lastDay = months.length
    ? Math.max(
        ...months[months.length - 1].txns.map((t) => Number(t.activity_date.slice(8, 10)))
      )
    : 0;

  const coverageDay = (key: number) => {
    const m = byKey.get(key);
    if (!m) return 0;
    return key === latestKey ? lastDay : m.days;
  };

  const totalCache = new Map<string, number>();
  const totalThrough = (key: number, day: number) => {
    const m = byKey.get(key);
    if (!m) return 0;
    const idx = Math.min(Math.max(day, 1), m.days) - 1;
    const cacheKey = `${key}|${idx}`;
    const hit = totalCache.get(cacheKey);
    if (hit !== undefined) return hit;
    const value = m.cumulative[idx] ?? 0;
    totalCache.set(cacheKey, value);
    return value;
  };

  const catCache = new Map<string, Map<string, number>>();
  const categoryTotalsThrough = (key: number, day: number) => {
    const cacheKey = `${key}|${day}`;
    const hit = catCache.get(cacheKey);
    if (hit) return hit;
    const sums = new Map<string, number>();
    const m = byKey.get(key);
    if (m) {
      for (const t of m.txns) {
        if (Number(t.activity_date.slice(8, 10)) > day) continue;
        const c = categoryOf(t);
        sums.set(c, (sums.get(c) ?? 0) + t.charged_amount);
      }
    }
    catCache.set(cacheKey, sums);
    return sums;
  };

  const categoryTotal = (key: number, category: string) =>
    categoryTotalsThrough(key, 31).get(category) ?? 0;

  const categories = [
    ...new Set(transactions.map(categoryOf)),
  ].sort((a, b) => (a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : a.localeCompare(b)));

  return {
    months,
    byKey,
    latestKey,
    coverageDay,
    totalThrough,
    categoryTotalsThrough,
    categoryTotal,
    categories,
  };
}
