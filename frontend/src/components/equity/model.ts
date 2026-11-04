import type { EquityGrant } from "@/lib/types";

/**
 * Valuation model for the Equity page (equity appreciation rights).
 *
 * - A grant pays its spread: units × (price − strike), and zero when the price
 *   is at or below the strike. All figures are before tax.
 * - Vesting starts on the grant date. Nothing vests before the cliff; at the
 *   cliff the elapsed months vest at once, then one more month's slice vests on
 *   the same day of each following month until `vesting_years` is done.
 *   Partial units count: vesting is spread evenly with no rounding.
 * - Two ways to get paid: an exit/IPO pays vested units at the exit price; if
 *   you leave first, vested units are bought out at the 409A of that day.
 *   Unvested units are forfeited either way.
 * - Today's 409A is the latest grant's strike (grants are priced at the 409A of
 *   their grant date). Its future is one of three paths (see `growthModel`).
 */

const YEAR_MS = 365.25 * 864e5;

// Grant colours: the app's colourblind-checked categorical order, validated in
// both themes. A sixth grant onwards folds into a neutral rather than cycling.
const GRANT_COLORS = ["var(--fx-at-1)", "var(--fx-at-2)", "var(--fx-at-3)", "var(--fx-at-4)", "var(--fx-at-5)"];
export const grantColor = (i: number) => GRANT_COLORS[i] ?? "var(--fx-ink-3)";

// Price scenarios are ordered, so they take a one-hue ramp rather than hues.
export const SCENARIO_MULTIPLES = [1, 2, 3, 5] as const;
export const SCENARIO_COLORS = ["var(--fx-ramp-1)", "var(--fx-ramp-2)", "var(--fx-ramp-3)", "var(--fx-ramp-4)"];

export const grantKey = (g: EquityGrant) => `g${g.id}`;

// ── Dates ───────────────────────────────────────────────────────────────────

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

export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());

/** Whole months from a to b; a month only counts once its day-of-month is reached. */
export function monthsBetween(a: Date, b: Date): number {
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m--;
  return m;
}

// ── Vesting & payout ────────────────────────────────────────────────────────

const totalMonths = (g: EquityGrant) => Math.max(1, (g.vesting_years || 4) * 12);

/** Fraction of the grant vested at `at`, 0..1. */
export function vestedFraction(g: EquityGrant, at: Date): number {
  const start = parseDate(g.grant_date);
  if (!start) return 0;
  const m = monthsBetween(start, at);
  if (m < (g.cliff_months || 0)) return 0;
  return Math.min(1, Math.max(0, m) / totalMonths(g));
}

/** Spread on every unit of the grant at `price`. */
export function spread(g: EquityGrant, price: number): number {
  return Math.max(0, price - (g.strike || 0)) * (g.shares || 0);
}

/** Vested units × spread at `price`, summed over grants: an exit at that price, or a buyout at that 409A. */
export const payoutAt = (grants: EquityGrant[], at: Date, price: number) =>
  grants.reduce((s, g) => s + spread(g, price) * vestedFraction(g, at), 0);

export function grantEnd(g: EquityGrant): Date | null {
  const start = parseDate(g.grant_date);
  return start ? addMonths(start, Math.ceil(totalMonths(g))) : null;
}

export function lastVestEnd(grants: EquityGrant[]): Date | null {
  let end: Date | null = null;
  for (const g of grants) {
    const e = grantEnd(g);
    if (e && (!end || e > end)) end = e;
  }
  return end;
}

/**
 * The latest known 409A: a grant is priced at the company's 409A on its grant
 * date, so the most recently dated grant's strike is the newest valuation we
 * have. Null when no grant has a date.
 */
export function latest409a(grants: EquityGrant[]): { price: number; grant: EquityGrant } | null {
  let latest: EquityGrant | null = null;
  for (const g of grants) {
    if (!g.grant_date) continue;
    if (!latest || g.grant_date > latest.grant_date! || (g.grant_date === latest.grant_date && g.id > latest.id)) {
      latest = g;
    }
  }
  return latest ? { price: latest.strike || 0, grant: latest } : null;
}

// ── 409A growth ─────────────────────────────────────────────────────────────

/**
 * - flat:   today's 409A held.
 * - recent: the average growth between consecutive grants, each period
 *           weighted by how recent it is (one a year older counts half).
 * - slow:   starts at the recent rate and keeps changing at the pace the rate
 *           itself has been changing (a fit of ln(rate) over time). It only
 *           ever slows; if growth hasn't been slowing it equals `recent`.
 */
export type FmvMode = "flat" | "slow" | "recent";
export const FMV_MODES: FmvMode[] = ["flat", "slow", "recent"];

export interface GrowthPoint { date: Date; strike: number; name: string }
export interface GrowthInterval { from: GrowthPoint; to: GrowthPoint; years: number; rate: number; mid: number }
export interface GrowthModel { points: GrowthPoint[]; intervals: GrowthInterval[]; recent: number; decay: number }

const HALF_LIFE_YEARS = 1;

export function growthModel(grants: EquityGrant[]): GrowthModel {
  const points = grants
    .filter((g) => g.grant_date && (g.strike || 0) > 0)
    .map((g) => ({ date: parseDate(g.grant_date)!, strike: g.strike, name: g.name || "Grant" }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const intervals: GrowthInterval[] = [];
  for (let i = 1; i < points.length; i++) {
    const years = (points[i].date.getTime() - points[i - 1].date.getTime()) / YEAR_MS;
    if (years < 1 / 12) continue; // grants in the same month say nothing about growth
    intervals.push({
      from: points[i - 1],
      to: points[i],
      years,
      rate: Math.pow(points[i].strike / points[i - 1].strike, 1 / years) - 1,
      mid: (points[i - 1].date.getTime() + points[i].date.getTime()) / 2,
    });
  }
  if (!intervals.length) return { points, intervals, recent: 0, decay: 0 };

  const lastT = points[points.length - 1].date.getTime();
  let wSum = 0, logSum = 0;
  for (const iv of intervals) {
    const w = Math.pow(0.5, (lastT - iv.mid) / YEAR_MS / HALF_LIFE_YEARS);
    wSum += w;
    logSum += w * Math.log(1 + iv.rate);
  }
  const recent = Math.exp(logSum / wSum) - 1;

  let decay = 0;
  if (intervals.length >= 2 && intervals.every((iv) => iv.rate > 0)) {
    const xs = intervals.map((iv) => iv.mid / YEAR_MS), ys = intervals.map((iv) => Math.log(iv.rate));
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    if (den > 0) decay = Math.min(0, num / den);
  }
  return { points, intervals, recent, decay };
}

/** Annual 409A growth rate in force at `at` under `mode`. */
export function rateAt(m: GrowthModel, mode: FmvMode, at: Date, today: Date): number {
  if (mode === "flat") return 0;
  if (mode === "recent") return m.recent;
  return m.recent * Math.exp(m.decay * Math.max(0, (at.getTime() - today.getTime()) / YEAR_MS));
}

/** The 409A on `at`, starting from today's (`f0`) and following `mode`. */
export function fmvAt(f0: number, m: GrowthModel, mode: FmvMode, at: Date, today: Date): number {
  const years = (at.getTime() - today.getTime()) / YEAR_MS;
  if (mode === "flat" || years <= 0 || f0 <= 0) return f0;
  if (mode === "recent") return f0 * Math.pow(1 + m.recent, years);
  // A slowing rate has no neat closed form: integrate month by month.
  const steps = Math.max(1, Math.ceil(years * 12)), dt = years / steps;
  let logF = Math.log(f0);
  for (let i = 0; i < steps; i++) {
    const t = new Date(today.getTime() + (i + 0.5) * dt * YEAR_MS);
    logF += Math.log(1 + Math.max(-0.9, rateAt(m, "slow", t, today))) * dt;
  }
  return Math.exp(logF);
}

// ── Page figures ────────────────────────────────────────────────────────────

export interface DecisionNumbers {
  leaveNow: number;
  perDollar: number;
  stay12Exit: number;
  stay12Buyout: number;
  forfeitExit: number;
  forfeitAt409a: number;
}

export function decisionNumbers(grants: EquityGrant[], price: number, fmv: (at: Date) => number, today: Date): DecisionNumbers {
  const in12 = addMonths(today, 12);
  const leaveNow = payoutAt(grants, today, fmv(today));
  return {
    leaveNow,
    perDollar: grants.reduce((s, g) => s + ((g.strike || 0) < price ? g.shares || 0 : 0), 0),
    stay12Exit: payoutAt(grants, in12, price) - payoutAt(grants, today, price),
    stay12Buyout: payoutAt(grants, in12, fmv(in12)) - leaveNow,
    forfeitExit: grants.reduce((s, g) => s + spread(g, price) * (1 - vestedFraction(g, today)), 0),
    forfeitAt409a: grants.reduce((s, g) => s + spread(g, fmv(today)) * (1 - vestedFraction(g, today)), 0),
  };
}

export type ScenarioRow = { t: number } & Record<string, number | null>;

/**
 * Payout if the exit happens on each date (monthly from today), at multiples of
 * `base`. Null before `earliest`: no exit is expected then.
 */
export function exitScenarios(grants: EquityGrant[], base: number, earliest: Date, today: Date): { rows: ScenarioRow[]; end: Date } {
  let end = addMonths(today, 24);
  const lv = lastVestEnd(grants);
  if (lv && lv > end) end = lv;
  const e12 = addMonths(earliest, 12);
  if (e12 > end) end = e12;
  end = addMonths(end, 2);

  const dates: Date[] = [];
  for (let k = 0; k <= 240; k++) {
    const d = addMonths(today, k);
    if (d > end) break;
    dates.push(d);
  }
  // A point exactly at the earliest exit so the lines start at the shaded edge.
  if (earliest > today && earliest < end && !dates.some((d) => d.getTime() === earliest.getTime())) {
    dates.push(earliest);
    dates.sort((a, b) => a.getTime() - b.getTime());
  }
  const rows = dates.map((d) => {
    const row: ScenarioRow = { t: d.getTime() };
    for (const k of SCENARIO_MULTIPLES) row[`x${k}`] = d >= earliest ? payoutAt(grants, d, base * k) : null;
    return row;
  });
  return { rows, end };
}

export interface GridRow { label: string; price: number; mine: boolean; values: number[] }
export interface ExitGridData { dates: Date[]; rows: GridRow[]; max: number }

/** Payout for each (exit date, exit price): dates every 6 months from the earliest exit. */
export function exitGrid(grants: EquityGrant[], price: number, base: number, earliest: Date): ExitGridData {
  const lv = lastVestEnd(grants);
  const until = addMonths(lv && lv > earliest ? lv : addMonths(earliest, 24), 5);
  const dates: Date[] = [];
  for (let k = 0; k < 8; k++) {
    const d = addMonths(earliest, k * 6);
    if (d > until) break;
    dates.push(d);
  }
  const prices = [1, 1.5, 2, 3, 4, 5].map((k) => ({ price: base * k, label: `${k}× · ${money2(base * k)}`, mine: false }));
  const mine = prices.find((p) => Math.abs(p.price - price) < 0.005);
  if (mine) mine.mine = true;
  else prices.push({ price, label: `Your price · ${money2(price)}`, mine: true });
  prices.sort((a, b) => b.price - a.price);
  const rows = prices.map((p) => ({ ...p, values: dates.map((d) => payoutAt(grants, d, p.price)) }));
  const max = Math.max(0, ...rows.flatMap((r) => r.values));
  return { dates, rows, max };
}

export type VestRow = { label: string; title: string; now?: boolean; total: number; buyout?: number } & Record<string, number | string | boolean | undefined>;

/** What each of the next `months` months of staying adds, per grant at `price`, and to a buyout. */
export function monthlyGains(grants: EquityGrant[], price: number, fmv: (at: Date) => number, today: Date, months = 36): VestRow[] {
  const rows: VestRow[] = [];
  for (let k = 1; k <= months; k++) {
    const t = addMonths(today, k), prev = addMonths(today, k - 1);
    const row: VestRow = { label: shortMonth(t), title: `Staying through ${monthYear(t)}`, total: 0 };
    for (const g of grants) {
      const v = spread(g, price) * (vestedFraction(g, t) - vestedFraction(g, prev));
      row[grantKey(g)] = v;
      row.total += v;
    }
    row.buyout = payoutAt(grants, t, fmv(t)) - payoutAt(grants, prev, fmv(prev));
    rows.push(row);
  }
  return rows;
}

/** Value vesting in each calendar year at `price`, per grant. */
export function yearlyVesting(grants: EquityGrant[], price: number, today: Date): VestRow[] {
  const starts = grants.map((g) => parseDate(g.grant_date)).filter((d): d is Date => d !== null);
  const lv = lastVestEnd(grants);
  if (!starts.length || !lv) return [];
  const y0 = Math.min(...starts.map((d) => d.getFullYear())), y1 = lv.getFullYear(), cy = today.getFullYear();
  const eoy = (y: number) => new Date(y, 11, 31);
  const rows: VestRow[] = [];
  for (let y = y0; y <= y1; y++) {
    const row: VestRow = { label: y === cy ? `${y} · now` : String(y), title: `Vesting in ${y}`, now: y === cy, total: 0 };
    for (const g of grants) {
      const v = spread(g, price) * (vestedFraction(g, eoy(y)) - vestedFraction(g, eoy(y - 1)));
      row[grantKey(g)] = v;
      row.total += v;
    }
    rows.push(row);
  }
  return rows;
}

export type HistoryRow = { t: number; hist?: number; histLabel?: string; name?: string; held?: number; flat?: number; slow?: number; recent?: number };

/** Grant strikes (with the growth into each) plus the three 409A paths from today to `end`. */
export function historyData(m: GrowthModel, f0: number, fmv: (mode: FmvMode, at: Date) => number, today: Date, end: Date): HistoryRow[] {
  const rows: HistoryRow[] = [];
  m.points.forEach((p, i) => {
    const into = m.intervals.find((iv) => iv.to === p);
    rows.push({ t: p.date.getTime(), hist: p.strike, name: p.name, histLabel: i && into ? `${pct(into.rate)}/yr` : undefined });
  });
  const last = m.points[m.points.length - 1];
  if (last && last.date < today) {
    rows[rows.length - 1].held = f0; // the latest strike stands until a new grant
  }
  const months = Math.max(1, monthsBetween(today, end));
  for (let k = 0; k <= months; k++) {
    const d = addMonths(today, k);
    rows.push({ t: d.getTime(), ...(k === 0 ? { held: f0 } : {}), flat: fmv("flat", d), slow: fmv("slow", d), recent: fmv("recent", d) });
  }
  return rows.sort((a, b) => a.t - b.t);
}

// ── Formatting ──────────────────────────────────────────────────────────────

export const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
export const money2 = (v: number) => `$${v.toFixed(2)}`;
export const pct = (r: number) => `${r >= 0 ? "+" : ""}${Math.round(r * 100)}%`;

export function usdShort(v: number): string {
  const a = Math.abs(v);
  const trim = (s: string) => s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  if (a >= 1e6) return `$${trim((v / 1e6).toFixed(2))}M`;
  if (a >= 1e4) return `$${Math.round(v / 1e3)}K`;
  if (a >= 1e3) return `$${trim((v / 1e3).toFixed(1))}K`;
  return usd(v);
}

export const monthYear = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
export const shortMonth = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
export const dayMonthYear = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Jan 1 of each year inside [start, end], for time-axis ticks. */
export function yearTicks(start: number, end: number): number[] {
  const out: number[] = [];
  for (let y = new Date(start).getFullYear() + 1; y <= new Date(end).getFullYear(); y++) out.push(new Date(y, 0, 1).getTime());
  return out;
}
