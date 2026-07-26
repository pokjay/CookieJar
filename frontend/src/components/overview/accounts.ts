import type { AccountBalancePoint } from "@/lib/types";

export interface AccountSeries {
  id: number;
  name: string;
  person: string;
  category: string;
  /** One balance per month, oldest first. */
  values: number[];
  balance: number;
}

export interface AccountsData {
  /** Month keys (year * 12 + month) matching every series index. */
  monthKeys: number[];
  accounts: AccountSeries[];
  /** Household total per month. */
  total: number[];
  /** Long-term holdings only (pension, hishtalmut, investments) per month. */
  invested: number[];
  persons: string[];
}

const INVESTED_CATEGORIES = new Set(["Investments", "Pension", "Hishtalmut"]);

/** Collapses the raw forward-filled points onto a dense monthly axis.
 *
 * Balances are only carried within each account's own lifetime: a closed
 * account contributes nothing after its final record, matching the backend's
 * net-worth aggregation rather than extrapolating money that has moved away.
 */
export function buildAccountsData(points: AccountBalancePoint[]): AccountsData {
  const byAccount = new Map<number, { meta: AccountBalancePoint; byMonth: Map<number, number> }>();
  let firstMonth = Infinity;
  let lastMonth = -Infinity;

  for (const p of points) {
    const key =
      Number(p.activity_date.slice(0, 4)) * 12 + Number(p.activity_date.slice(5, 7)) - 1;
    if (key < firstMonth) firstMonth = key;
    if (key > lastMonth) lastMonth = key;
    let entry = byAccount.get(p.account_id);
    if (!entry) {
      entry = { meta: p, byMonth: new Map() };
      byAccount.set(p.account_id, entry);
    }
    // Points arrive date-sorted, so the last write per month is the month-end balance.
    entry.byMonth.set(key, p.amount);
  }

  if (!byAccount.size) {
    return { monthKeys: [], accounts: [], total: [], invested: [], persons: [] };
  }

  const monthKeys = Array.from({ length: lastMonth - firstMonth + 1 }, (_, i) => firstMonth + i);

  const accounts: AccountSeries[] = [...byAccount.entries()]
    .map(([id, { meta, byMonth }]) => {
      const recorded = [...byMonth.keys()];
      const opened = Math.min(...recorded);
      const closed = Math.max(...recorded);
      let carried = 0;
      const values = monthKeys.map((k) => {
        const v = byMonth.get(k);
        if (v !== undefined) carried = v;
        return k >= opened && k <= closed ? carried : 0;
      });
      return {
        id,
        name: meta.name,
        person: meta.person,
        category: meta.category,
        values,
        balance: values[values.length - 1] ?? 0,
      };
    })
    // A closed account has dropped to nothing; it shouldn't clutter the list.
    .filter((a) => a.balance > 0)
    .sort((a, b) => b.balance - a.balance);

  const total = monthKeys.map((_, i) => accounts.reduce((s, a) => s + a.values[i], 0));
  const invested = monthKeys.map((_, i) =>
    accounts.reduce((s, a) => (INVESTED_CATEGORIES.has(a.category) ? s + a.values[i] : s), 0)
  );

  const persons = [...new Set(accounts.map((a) => a.person))].sort();

  return { monthKeys, accounts, total, invested, persons };
}

export const RANGES = {
  "6M": 7,
  YTD: 0,
  "1Y": 13,
  "3Y": 37,
} as const;

export type RangeKey = keyof typeof RANGES;

/** Index into the month arrays where the selected range starts. */
export function rangeStart(range: RangeKey, monthKeys: number[]): number {
  if (!monthKeys.length) return 0;
  if (range === "YTD") {
    const latest = monthKeys[monthKeys.length - 1];
    const january = Math.floor(latest / 12) * 12;
    const idx = monthKeys.findIndex((k) => k >= january);
    return idx < 0 ? 0 : idx;
  }
  return Math.max(0, monthKeys.length - RANGES[range]);
}
