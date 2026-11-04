import type { OptionGrant } from "@/lib/types";

/**
 * Valuation model for the Options page.
 *
 * - Value of a grant is its intrinsic value: shares × (price − strike), and
 *   zero when the price is at or below the strike. Before tax, dilution or any
 *   illiquidity discount.
 * - Vesting starts on the grant date. Nothing vests before the cliff; at the
 *   cliff the elapsed months vest at once, then one more month's slice vests on
 *   the same day of each following month until `vesting_years` is done.
 * - Partial shares count: vesting is spread evenly with no rounding.
 */

/** Same palette (and order) as the redesigned pages' categorical series. */
export const GRANT_COLORS = [
  "var(--fx-s3)",
  "var(--fx-s2)",
  "var(--fx-s1)",
  "var(--fx-s5)",
  "var(--fx-s7)",
  "var(--fx-s4)",
  "var(--fx-s6)",
  "var(--fx-s8)",
];

export const grantColor = (i: number) => GRANT_COLORS[i % GRANT_COLORS.length];

/** "YYYY-MM-DD" → local Date (no UTC shift), or null. */
export function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return y ? new Date(y, (m || 1) - 1, d || 1) : null;
}

export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole months from a to b; a month only counts once its day-of-month is reached. */
export function monthsBetween(a: Date, b: Date): number {
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m--;
  return m;
}

const totalMonths = (g: OptionGrant) => Math.max(1, (g.vesting_years || 4) * 12);

/** Fraction of the grant vested at `at`, 0..1. */
export function vestedFraction(g: OptionGrant, at: Date): number {
  const start = parseDate(g.grant_date);
  if (!start) return 0;
  const m = monthsBetween(start, at);
  if (m < (g.cliff_months || 0)) return 0;
  return Math.min(1, Math.max(0, m) / totalMonths(g));
}

/** Intrinsic value of every share in the grant at `price`. */
export function spread(g: OptionGrant, price: number): number {
  return Math.max(0, price - (g.strike || 0)) * (g.shares || 0);
}

/** Next date on which more of this grant vests, or null if fully vested / undated. */
export function nextVestDate(g: OptionGrant, today: Date): Date | null {
  const start = parseDate(g.grant_date);
  if (!start || vestedFraction(g, today) >= 1) return null;
  const m = Math.max(g.cliff_months || 0, monthsBetween(start, today) + 1);
  if (m > totalMonths(g)) return null;
  return new Date(start.getFullYear(), start.getMonth() + m, start.getDate());
}

export interface Totals {
  all: number;
  vested: number;
  unvested: number;
  vestedShares: number;
  nextVest: Date | null;
}

export function computeTotals(grants: OptionGrant[], price: number, today: Date): Totals {
  let all = 0;
  let vested = 0;
  let vestedShares = 0;
  let nextVest: Date | null = null;
  for (const g of grants) {
    const f = vestedFraction(g, today);
    const value = spread(g, price);
    all += value;
    vested += value * f;
    vestedShares += (g.shares || 0) * f;
    const nv = nextVestDate(g, today);
    if (nv && (!nextVest || nv < nextVest)) nextVest = nv;
  }
  return { all, vested, unvested: all - vested, vestedShares, nextVest };
}

/**
 * The latest known 409A: a grant is priced at the company's 409A on its grant
 * date, so the most recently dated grant's strike is the newest valuation we
 * have. Null when no grant has a date.
 */
export function latest409a(grants: OptionGrant[]): { price: number; grant: OptionGrant } | null {
  let latest: OptionGrant | null = null;
  for (const g of grants) {
    if (!g.grant_date) continue;
    if (!latest || g.grant_date > latest.grant_date! || (g.grant_date === latest.grant_date && g.id > latest.id)) {
      latest = g;
    }
  }
  return latest ? { price: latest.strike || 0, grant: latest } : null;
}

export const grantKey = (g: OptionGrant) => `g${g.id}`;

/**
 * Rows for the value-by-share-price chart: one row per price point from 0 to
 * `maxPrice`, plus a point exactly at each strike so every band's kink is drawn
 * where it really is.
 */
export function priceCurve(
  grants: OptionGrant[],
  maxPrice: number,
  vestedOnly: boolean,
  today: Date,
  steps = 120,
): Record<string, number>[] {
  const xs = new Set<number>();
  for (let s = 0; s <= steps; s++) xs.add(+((maxPrice * s) / steps).toFixed(4));
  for (const g of grants) if (g.strike > 0 && g.strike < maxPrice) xs.add(g.strike);
  const factors = grants.map((g) => (vestedOnly ? vestedFraction(g, today) : 1));
  return [...xs]
    .sort((a, b) => a - b)
    .map((price) => {
      const row: Record<string, number> = { price };
      grants.forEach((g, i) => (row[grantKey(g)] = spread(g, price) * factors[i]));
      return row;
    });
}

export interface TimelineRow {
  label: string;
  /** Month-end timestamp; the value plotted is what's vested by then. */
  t: number;
  [grantKey: string]: number | string;
}

/** Month-by-month vested value at `price`, from the first grant until the last one is fully vested. */
export function vestingTimeline(grants: OptionGrant[], price: number): TimelineRow[] {
  const dated = grants
    .map((g) => ({ g, start: parseDate(g.grant_date) }))
    .filter((x): x is { g: OptionGrant; start: Date } => x.start !== null);
  if (!dated.length) return [];

  const first = new Date(Math.min(...dated.map((x) => x.start.getTime())));
  const lastEnd = Math.max(
    ...dated.map(({ g, start }) =>
      new Date(start.getFullYear(), start.getMonth() + Math.ceil(totalMonths(g)) + 1, 1).getTime(),
    ),
  );

  const rows: TimelineRow[] = [];
  for (
    let d = new Date(first.getFullYear(), first.getMonth(), 1);
    d.getTime() <= lastEnd;
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  ) {
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const row: TimelineRow = {
      label: monthEnd.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      t: monthEnd.getTime(),
    };
    for (const g of grants) row[grantKey(g)] = spread(g, price) * vestedFraction(g, monthEnd);
    rows.push(row);
  }
  return rows;
}

export const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export function usdShort(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `$${Math.round(v / 1e3)}K`;
  return usd(v);
}
