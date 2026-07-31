import type { AccountBalancePoint, RangeKey } from "@/lib/types";

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

/** One account type (Pension, Hishtalmut, …) with its member accounts summed. */
export interface CategorySeries {
  category: string;
  accountCount: number;
  /** Element-wise sum of the member accounts' values. */
  values: number[];
  balance: number;
}

/** Draw order for the stacked net-worth chart, bottom band first.
 *
 * Fixed rather than sorted by size so a type keeps its colour and its place in
 * the stack as balances move. The five hues alternate cool/warm because the
 * bands sit edge to edge — see `--fx-at-*` in globals.css.
 */
export const ACCOUNT_TYPE_ORDER = [
  "Investments",
  "Pension",
  "Hishtalmut",
  "Rainy Day Fund",
  "Bank Account",
];

export function accountTypeColor(category: string): string {
  const i = ACCOUNT_TYPE_ORDER.indexOf(category);
  return i < 0 ? "var(--fx-ink-3)" : `var(--fx-at-${i + 1})`;
}

/** Sorts category series into `ACCOUNT_TYPE_ORDER`, unknown types last. */
export function orderByAccountType(groups: CategorySeries[]): CategorySeries[] {
  const rank = (c: string) => {
    const i = ACCOUNT_TYPE_ORDER.indexOf(c);
    return i < 0 ? ACCOUNT_TYPE_ORDER.length : i;
  };
  return [...groups].sort((a, b) => rank(a.category) - rank(b.category));
}

/** Collapses a person's accounts onto one series per account type. */
export function groupByCategory(accounts: AccountSeries[], monthCount: number): CategorySeries[] {
  const byCategory = new Map<string, CategorySeries>();

  for (const account of accounts) {
    let group = byCategory.get(account.category);
    if (!group) {
      group = {
        category: account.category,
        accountCount: 0,
        values: new Array(monthCount).fill(0),
        balance: 0,
      };
      byCategory.set(account.category, group);
    }
    group.accountCount += 1;
    for (let i = 0; i < monthCount; i++) group.values[i] += account.values[i] ?? 0;
  }

  return [...byCategory.values()]
    .map((g) => ({ ...g, balance: g.values[monthCount - 1] ?? 0 }))
    .sort((a, b) => b.balance - a.balance);
}

/** Month-end points each range covers — one more than its span, so "6M" spans
 * six intervals. YTD is derived from the calendar; ALL never trims. */
export const RANGES: Record<RangeKey, number> = {
  "1M": 2,
  "3M": 4,
  "6M": 7,
  YTD: 0,
  "1Y": 13,
  "3Y": 37,
  "5Y": 61,
  ALL: Infinity,
};

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
