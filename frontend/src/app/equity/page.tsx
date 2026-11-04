"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Plus, Trash2, CheckCircle2, AlertCircle, Loader2, ChevronDown } from "lucide-react";
import {
  createEquityGrant,
  deleteEquityGrant,
  getEquityGrants,
  updateEquityGrant,
} from "@/lib/api";
import type { EquityGrant, EquityGrantPayload } from "@/lib/types";
import { Card, SectionHeader, SegmentedControl, StatTile } from "@/components/ledger/ui";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  ChartLegend,
  DataTable,
  ExitGrid,
  ExitScenariosChart,
  HistoryChart,
  VestingAheadChart,
  type HistoryPath,
} from "@/components/equity/EquityCharts";
import {
  FMV_MODES,
  SCENARIO_COLORS,
  SCENARIO_MULTIPLES,
  addMonths,
  decisionNumbers,
  exitGrid,
  exitScenarios,
  fmvAt,
  grantColor,
  grantEnd,
  grantKey,
  growthModel,
  historyData,
  lastVestEnd,
  latest409a,
  money2,
  monthYear,
  monthlyGains,
  parseDate,
  payoutAt,
  pct,
  rateAt,
  spread,
  toISODate,
  usd,
  vestedFraction,
  yearlyVesting,
  type FmvMode,
} from "@/components/equity/model";

// The exit price, earliest exit, 409A path and view toggles are "play with it"
// inputs, so they live in this browser only. Grants are stored in the database;
// today's 409A is derived from them (the latest grant's strike).
const EXPLORER_KEY = "equity-explorer-v1";

type VestView = "monthly" | "yearly";

interface Explorer {
  price: number;
  earliest: string;
  fmvMode: FmvMode;
  vestView: VestView;
  gridOpen: boolean;
}

const defaultExplorer = (today: Date): Explorer => ({
  price: 60,
  // No exit is expected within the next year.
  earliest: toISODate(addMonths(today, 12)),
  fmvMode: "slow",
  vestView: "monthly",
  gridOpen: false,
});

function loadExplorer(today: Date): Explorer {
  const d = defaultExplorer(today);
  try {
    const raw = localStorage.getItem(EXPLORER_KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    return {
      price: typeof s.price === "number" && s.price >= 0 ? s.price : d.price,
      earliest: typeof s.earliest === "string" && parseDate(s.earliest) ? s.earliest : d.earliest,
      fmvMode: FMV_MODES.includes(s.fmvMode) ? s.fmvMode : d.fmvMode,
      vestView: s.vestView === "yearly" ? "yearly" : "monthly",
      gridOpen: s.gridOpen === true,
    };
  } catch {
    // private mode / blocked storage: fall back to defaults
    return d;
  }
}

const MODE_TEXT: Record<FmvMode, string> = {
  flat: "Stays at today’s",
  slow: "Growth keeps slowing",
  recent: "Holds the recent rate",
};

/** Keep values the backend accepts (it rejects negatives and zero-year vesting). */
function sanitize(g: EquityGrant): EquityGrantPayload {
  return {
    name: g.name.trim(),
    grant_date: g.grant_date || null,
    shares: Math.max(0, g.shares || 0),
    strike: Math.max(0, g.strike || 0),
    vesting_years: g.vesting_years > 0 ? g.vesting_years : 4,
    cliff_months: Math.max(0, Math.round(g.cliff_months || 0)),
  };
}

const samePayload = (a: EquityGrantPayload, b: EquityGrantPayload) =>
  JSON.stringify(a) === JSON.stringify(b);

type SaveState = "idle" | "saving" | "saved" | "error";

const INPUT_BASE =
  "min-w-0 rounded-[8px] border border-fx-line bg-fx-surface-2 px-2 py-1.5 text-[13px] text-fx-ink " +
  "focus:border-fx-accent focus:outline-none focus:ring-2 focus:ring-fx-accent-soft";
const INPUT = `w-full ${INPUT_BASE}`;

/** A plain-language reading of a chart, with the key figures in bold. */
function Read({ children }: { children: ReactNode }) {
  return <p className="mt-3 max-w-[80ch] text-[12.5px] text-fx-ink [&_b]:font-semibold">{children}</p>;
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="-mt-1 mb-3 text-[12px] text-fx-ink-3">{children}</p>;
}

// ── Grant row ────────────────────────────────────────────────────────────────

type Field = "name" | "grant_date" | "shares" | "strike" | "vesting_years" | "cliff_months";

const toDraft = (g: EquityGrant): Record<Field, string> => ({
  name: g.name,
  grant_date: g.grant_date ?? "",
  shares: String(g.shares),
  strike: String(g.strike),
  vesting_years: String(g.vesting_years),
  cliff_months: String(g.cliff_months),
});

function GrantRow({
  grant,
  index,
  price,
  fmvToday,
  today,
  autoFocus,
  onLiveChange,
  onCommit,
  onDelete,
}: {
  grant: EquityGrant;
  index: number;
  price: number;
  fmvToday: number;
  today: Date;
  autoFocus: boolean;
  onLiveChange: (g: EquityGrant) => void;
  onCommit: (g: EquityGrant) => void;
  onDelete: (g: EquityGrant) => void;
}) {
  // Inputs keep their own text so "4." or an empty field can be typed through;
  // the parsed grant is pushed up on every keystroke so the charts follow live.
  const [draft, setDraft] = useState(() => toDraft(grant));

  const parse = (d: Record<Field, string>): EquityGrant => ({
    id: grant.id,
    name: d.name,
    grant_date: d.grant_date || null,
    shares: parseFloat(d.shares) || 0,
    strike: parseFloat(d.strike) || 0,
    vesting_years: parseFloat(d.vesting_years) || 0,
    cliff_months: parseFloat(d.cliff_months) || 0,
  });

  const set = (k: Field) => (e: ChangeEvent<HTMLInputElement>) => {
    const next = { ...draft, [k]: e.target.value };
    setDraft(next);
    onLiveChange(parse(next));
  };

  const commit = () => {
    const parsed = parse(draft);
    const clean = { id: grant.id, ...sanitize(parsed) };
    setDraft(toDraft(clean));
    onCommit(clean);
  };

  const f = vestedFraction(grant, today);
  const label = grant.name || "Grant";
  const cell = "px-1.5 py-1.5";

  return (
    <tr className="border-b border-fx-line-2 last:border-0">
      <td className={cell}>
        <i className="block h-2.5 w-2.5 rounded-[3px]" style={{ background: grantColor(index) }} />
      </td>
      <td className={cell}>
        <input
          aria-label="Grant name"
          className={INPUT}
          value={draft.name}
          onChange={set("name")}
          onBlur={commit}
          autoFocus={autoFocus}
          onFocus={autoFocus ? (e) => e.target.select() : undefined}
        />
      </td>
      <td className={cell}>
        <input type="date" aria-label={`${label} grant date`} className={INPUT} value={draft.grant_date} onChange={set("grant_date")} onBlur={commit} />
      </td>
      <td className={cell}>
        <input type="number" min={0} step={1} aria-label={`${label} shares`} className={`${INPUT} fx-num`} value={draft.shares} onChange={set("shares")} onBlur={commit} />
      </td>
      <td className={cell}>
        <input type="number" min={0} step={0.01} aria-label={`${label} strike price`} className={`${INPUT} fx-num`} value={draft.strike} onChange={set("strike")} onBlur={commit} />
      </td>
      <td className={cell}>
        <input type="number" min={1} step={1} aria-label={`${label} vesting years`} className={`${INPUT} fx-num`} value={draft.vesting_years} onChange={set("vesting_years")} onBlur={commit} />
      </td>
      <td className={cell}>
        <input type="number" min={0} step={1} aria-label={`${label} cliff months`} className={`${INPUT} fx-num`} value={draft.cliff_months} onChange={set("cliff_months")} onBlur={commit} />
      </td>
      <td className={`${cell} fx-num text-right text-[13px]`}>{Math.round(f * 100)}%</td>
      <td className={`${cell} fx-num text-right text-[13px]`}>{usd(spread(grant, fmvToday) * f)}</td>
      <td className={`${cell} fx-num text-right text-[13px]`}>{usd(spread(grant, price))}</td>
      <td className={`${cell} text-right`}>
        <button
          type="button"
          onClick={() => onDelete(grant)}
          aria-label={`Delete ${label}`}
          className="rounded-[7px] p-1.5 text-fx-ink-3 transition-colors hover:bg-fx-surface-2 hover:text-fx-negative"
        >
          <Trash2 size={15} />
        </button>
      </td>
    </tr>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function EquityPage() {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [grants, setGrants] = useState<EquityGrant[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [explorer, setExplorer] = useState<Explorer>(() => defaultExplorer(today));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [pendingDelete, setPendingDelete] = useState<EquityGrant | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  // What the server last confirmed, so blurring an unchanged field is a no-op.
  const saved = useRef<Map<number, EquityGrantPayload>>(new Map());

  useEffect(() => {
    setExplorer(loadExplorer(today));
    getEquityGrants()
      .then((data) => {
        setGrants(data);
        saved.current = new Map(data.map((g) => [g.id, sanitize(g)]));
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [today]);

  const updateExplorer = useCallback((patch: Partial<Explorer>) => {
    setExplorer((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(EXPLORER_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable: the value still applies for this visit
      }
      return next;
    });
  }, []);

  const setPrice = (v: number) => updateExplorer({ price: Math.max(0, Number.isFinite(v) ? v : 0) });

  const replaceGrant = (g: EquityGrant) =>
    setGrants((prev) => prev.map((x) => (x.id === g.id ? g : x)));

  async function commitGrant(g: EquityGrant) {
    replaceGrant(g);
    const payload = sanitize(g);
    const last = saved.current.get(g.id);
    if (last && samePayload(last, payload)) return;
    setSaveState("saving");
    try {
      const stored = await updateEquityGrant(g.id, payload);
      saved.current.set(stored.id, sanitize(stored));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  async function addGrant() {
    setAdding(true);
    setSaveState("saving");
    try {
      const created = await createEquityGrant({
        name: "New grant",
        grant_date: toISODate(today),
        shares: 1000,
        // A new grant is priced at the current 409A, which is the latest strike.
        strike: f0 || 10,
        vesting_years: 4,
        cliff_months: 12,
      });
      saved.current.set(created.id, sanitize(created));
      setGrants((prev) => [...prev, created]);
      setFocusId(created.id);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    } finally {
      setAdding(false);
    }
  }

  async function confirmDelete() {
    const g = pendingDelete;
    setPendingDelete(null);
    if (!g) return;
    setSaveState("saving");
    try {
      await deleteEquityGrant(g.id);
      saved.current.delete(g.id);
      setGrants((prev) => prev.filter((x) => x.id !== g.id));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  // ── Derived figures ───────────────────────────────────────────────────────
  const { price, fmvMode, vestView, gridOpen } = explorer;
  const earliestIso = explorer.earliest;
  const earliest = useMemo(() => parseDate(earliestIso) ?? addMonths(today, 12), [earliestIso, today]);
  const fmvSource = latest409a(grants);
  const f0 = fmvSource?.price ?? 0;
  const growth = useMemo(() => growthModel(grants), [grants]);
  const fmvOf = useCallback((mode: FmvMode, at: Date) => fmvAt(f0, growth, mode, at, today), [f0, growth, today]);
  const fmv = useCallback((at: Date) => fmvOf(fmvMode, at), [fmvOf, fmvMode]);

  const decision = useMemo(() => decisionNumbers(grants, price, fmv, today), [grants, price, fmv, today]);
  const scenarios = useMemo(() => (f0 > 0 ? exitScenarios(grants, f0, earliest, today) : null), [grants, f0, earliest, today]);
  const grid = useMemo(() => (f0 > 0 ? exitGrid(grants, price, f0, earliest) : null), [grants, price, f0, earliest]);
  const monthly = useMemo(() => monthlyGains(grants, price, fmv, today), [grants, price, fmv, today]);
  const yearly = useMemo(() => yearlyVesting(grants, price, today), [grants, price, today]);
  const lv = useMemo(() => lastVestEnd(grants), [grants]);
  const lvTime = lv?.getTime() ?? 0;
  const historyEnd = useMemo(() => new Date(Math.max(addMonths(today, 36).getTime(), lvTime)), [today, lvTime]);
  const history = useMemo(
    () => (growth.intervals.length ? historyData(growth, f0, fmvOf, today, historyEnd) : []),
    [growth, f0, fmvOf, today, historyEnd],
  );

  const maxPrice = Math.max(150, Math.ceil(f0) * 10, Math.ceil(price / 10) * 10);
  const chips = f0 > 0 ? SCENARIO_MULTIPLES.map((k) => [k === 1 ? "409A" : `${k}×`, f0 * k] as const) : [];
  const slowNow = rateAt(growth, "slow", today, today);
  const modeOption = (m: FmvMode) =>
    m === "flat"
      ? MODE_TEXT.flat
      : m === "recent"
        ? `${MODE_TEXT.recent} (${pct(growth.recent)}/yr)`
        : growth.decay < 0
          ? `${MODE_TEXT.slow} (${pct(slowNow)} now, easing)`
          : MODE_TEXT.slow;

  if (loading) {
    return (
      <div className="fx flex min-h-screen items-center justify-center">
        <p className="text-fx-ink-2">Loading…</p>
      </div>
    );
  }

  const grantLegend = grants.map((g, i) => ({ label: `${g.name || "Grant"} · ${money2(g.strike || 0)}`, color: grantColor(i) }));
  const in3y = addMonths(today, 36);

  return (
    <div className="fx min-h-screen">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-[22px] px-5 py-5 pb-8">
        <div>
          <h1 className="text-[19px] font-semibold tracking-[-0.02em]">Equity</h1>
          <p className="mt-[5px] max-w-[72ch] text-[12.5px] text-fx-ink-3">
            What your equity appreciation rights could pay, in US dollars, before tax. An exit pays vested units ×
            (exit price − strike); if you leave first, vested units are bought out at the 409A of that day. Unvested
            units are forfeited. For exploring only: not counted in net worth.
          </p>
        </div>

        {loadError && (
          <Card>
            <p className="text-[12.5px] text-fx-negative">Couldn&rsquo;t load your grants. Refresh to try again.</p>
          </Card>
        )}

        {/* Assumptions */}
        <Card>
          <div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:items-center">
            <div>
              <SectionHeader label="EXIT PRICE PER SHARE" />
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="fx-num text-[38px] leading-none">{money2(price)}</span>
                {f0 > 0 && <span className="fx-num text-[12px] text-fx-ink-3">{(price / f0).toFixed(1)}× today&rsquo;s 409A</span>}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={maxPrice}
                  step={0.5}
                  value={price}
                  onChange={(e) => setPrice(parseFloat(e.target.value))}
                  aria-label="Exit price per share"
                  className="min-w-0 flex-1 accent-[var(--fx-accent)]"
                />
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  aria-label="Exit price"
                  className={`${INPUT_BASE} fx-num w-[92px] flex-none`}
                  value={price}
                  onChange={(e) => setPrice(parseFloat(e.target.value))}
                />
              </div>
              {chips.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {chips.map(([label, v]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setPrice(+v.toFixed(2))}
                      className="rounded-full border border-fx-line px-3 py-1 font-fx-mono text-[11.5px] text-fx-ink-2 transition-colors hover:border-fx-accent hover:text-fx-accent"
                    >
                      {label} · {money2(v)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-[10.5px] text-fx-ink-3">Earliest exit</span>
                <input
                  type="date"
                  className={INPUT}
                  value={earliestIso}
                  onChange={(e) => {
                    if (parseDate(e.target.value)) updateExplorer({ earliest: e.target.value });
                  }}
                />
              </label>
              <div className="grid gap-1">
                <span className="text-[10.5px] text-fx-ink-3">Today&rsquo;s 409A</span>
                <span
                  className="fx-num px-0.5 py-1.5 text-[13px]"
                  title="The strike of your most recent grant: grants are priced at the 409A of their grant date"
                >
                  {fmvSource ? money2(f0) : "—"}
                  <span className="ml-2 font-[inherit] text-[10.5px] text-fx-ink-3">
                    {fmvSource ? `from ${fmvSource.grant.name || "latest grant"}` : "add a dated grant"}
                  </span>
                </span>
              </div>
              <label className="grid gap-1 sm:col-span-2">
                <span className="text-[10.5px] text-fx-ink-3">409A after today</span>
                <select
                  className={INPUT}
                  value={fmvMode}
                  onChange={(e) => updateExplorer({ fmvMode: e.target.value as FmvMode })}
                >
                  {FMV_MODES.map((m) => (
                    <option key={m} value={m}>{modeOption(m)}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </Card>

        {/* Decision numbers */}
        <div className="flex flex-wrap gap-2.5">
          <StatTile
            label="If you leave today"
            value={usd(decision.leaveNow)}
            color="var(--fx-accent)"
            sub={`vested units bought out at the ${money2(f0)} 409A`}
          />
          <StatTile label="Each $1 of exit price" value={`+${usd(decision.perDollar)}`} sub="across all granted units, once vested" />
          <StatTile
            label="Staying 12 more months adds"
            value={`+${usd(decision.stay12Exit)}`}
            sub={`at a ${money2(price)} exit · +${usd(decision.stay12Buyout)} to a buyout`}
          />
          <StatTile
            label="Unvested, lost if you leave today"
            value={usd(decision.forfeitExit)}
            sub={`at a ${money2(price)} exit · ${usd(decision.forfeitAt409a)} at the 409A`}
          />
        </div>

        {grants.length > 0 && scenarios && grid && (
          <>
            {/* Exit scenarios */}
            <Card>
              <SectionHeader label="EXIT SCENARIOS" />
              <Caption>If the exit happens on a given date, what you&rsquo;d get at 1×, 2×, 3× or 5× today&rsquo;s 409A.</Caption>
              <ExitScenariosChart
                rows={scenarios.rows}
                start={today.getTime()}
                earliest={earliest.getTime()}
                end={scenarios.end.getTime()}
                series={SCENARIO_MULTIPLES.map((k, i) => ({
                  key: `x${k}`,
                  short: `${k}×`,
                  label: `${k}× 409A · ${money2(f0 * k)}`,
                  color: SCENARIO_COLORS[i],
                }))}
              />
              <ChartLegend items={SCENARIO_MULTIPLES.map((k, i) => ({ label: `${k}× 409A · ${money2(f0 * k)}`, color: SCENARIO_COLORS[i], line: true }))} />
              <Read>
                If the exit comes in <b>{monthYear(earliest)}</b>, you&rsquo;d get <b>{usd(payoutAt(grants, earliest, f0))}</b> at 1× and{" "}
                <b>{usd(payoutAt(grants, earliest, f0 * 5))}</b> at 5×. The lines keep rising until your last grant finishes vesting
                {lv ? <> in <b>{monthYear(lv)}</b></> : null}.
              </Read>
              <DataTable
                headers={["Exit date", ...SCENARIO_MULTIPLES.map((k) => `${k}× (${money2(f0 * k)})`)]}
                rows={scenarios.rows
                  .filter((r) => r[`x1`] != null)
                  .filter((_, i) => i % 6 === 0)
                  .map((r) => [monthYear(new Date(r.t)), ...SCENARIO_MULTIPLES.map((k) => usd(r[`x${k}`] as number))])}
              />
            </Card>

            {/* Exit payout grid */}
            <Card>
              <SectionHeader
                label="EXIT PAYOUT GRID"
                trailing={
                  <button
                    type="button"
                    aria-expanded={gridOpen}
                    onClick={() => updateExplorer({ gridOpen: !gridOpen })}
                    className="inline-flex items-center gap-1 rounded-[7px] px-2 py-1 text-[11.5px] font-semibold text-fx-accent hover:bg-fx-accent-soft"
                  >
                    {gridOpen ? "Show your price only" : "Show all prices"}
                    <ChevronDown size={14} className={`transition-transform ${gridOpen ? "rotate-180" : ""}`} />
                  </button>
                }
              />
              <Caption>
                Exact payout for each exit date and price, counting only units vested by then. Later exits add vesting; higher prices
                multiply the spread.
              </Caption>
              <ExitGrid grid={grid} expanded={gridOpen} />
            </Card>

            {/* Vesting ahead */}
            <Card>
              <SectionHeader
                label="VESTING AHEAD"
                trailing={
                  <SegmentedControl
                    size="sm"
                    ariaLabel="Vesting view"
                    value={vestView}
                    onChange={(v) => updateExplorer({ vestView: v })}
                    options={[
                      { value: "monthly", label: "Monthly" },
                      { value: "yearly", label: "Yearly" },
                    ]}
                  />
                }
              />
              <Caption>
                {vestView === "monthly"
                  ? `What each of the next 36 months at the company adds: bars at a ${money2(price)} exit, the line to a buyout.`
                  : `How much vests in each calendar year, at a ${money2(price)} exit price.`}
              </Caption>
              <VestingAheadChart
                rows={vestView === "monthly" ? monthly : yearly}
                grants={grants}
                view={vestView}
                totalLabel={`Added to an exit at ${money2(price)}`}
                buyoutLabel="Added to a buyout"
              />
              <ChartLegend items={vestView === "monthly" ? [...grantLegend, { label: "Added to a buyout if you leave", color: "var(--fx-ink)", line: true }] : grantLegend} />
              {vestView === "monthly" ? <MonthlyRead rows={monthly} grants={grants} price={price} today={today} mode={fmvMode} /> : <YearlyRead rows={yearly} price={price} today={today} />}
              <DataTable
                headers={[vestView === "monthly" ? "Month" : "Year", ...grants.map((g) => g.name || "Grant"), `Exit at ${money2(price)}`, ...(vestView === "monthly" ? ["Buyout"] : [])]}
                rows={(vestView === "monthly" ? monthly : yearly).map((r) => [
                  vestView === "monthly" ? r.title.replace("Staying through ", "") : r.label,
                  ...grants.map((g) => usd(Number(r[grantKey(g)] ?? 0))),
                  usd(r.total),
                  ...(vestView === "monthly" ? [usd(r.buyout ?? 0)] : []),
                ])}
              />
            </Card>

            {/* 409A history & outlook */}
            {history.length > 0 && (
              <Card>
                <SectionHeader label="409A HISTORY & OUTLOOK" />
                <Caption>Your grant strikes are the 409A on each grant date. From today, three paths for where it goes next.</Caption>
                <HistoryChart
                  rows={history}
                  paths={historyPaths(growth.recent)}
                  selected={fmvMode}
                  start={addMonths(growth.points[0].date, -4).getTime()}
                  end={historyEnd.getTime()}
                  today={today.getTime()}
                />
                <ChartLegend
                  items={[
                    { label: "Grant strikes (the 409A on each grant date)", color: "var(--fx-at-1)", line: true },
                    ...historyPaths(growth.recent).map((p) => ({ label: p.mode === fmvMode ? `${p.label} · in use` : p.label, color: p.color, line: true, dashed: p.dashed })),
                  ]}
                />
                <Read>
                  Growth between your grants went <b>{growth.intervals.map((iv) => pct(iv.rate)).join(" → ")}</b> a year.{" "}
                  {growth.decay < 0 ? (
                    <>
                      Continuing that slowdown gives about{" "}
                      <b>{[1, 2, 3].map((k) => pct(rateAt(growth, "slow", addMonths(today, 12 * k - 6), today))).join(", ")}</b> over the
                      next three years, for a 409A of <b>{money2(fmvOf("slow", in3y))}</b> in <b>{monthYear(in3y)}</b>.{" "}
                    </>
                  ) : (
                    <>Growth hasn&rsquo;t been slowing, so &ldquo;keeps slowing&rdquo; holds the recent rate. </>
                  )}
                  Holding the recent rate gives <b>{money2(fmvOf("recent", in3y))}</b>; flat stays at <b>{money2(f0)}</b>. The path in use
                  feeds the buyout figures above.
                </Read>
                <DataTable
                  headers={["Date", "Flat", "Keeps slowing", "Rate that year", "Recent rate"]}
                  rows={[0, 1, 2, 3, 4].map((k) => {
                    const d = addMonths(today, 12 * k);
                    return [
                      k ? monthYear(d) : "Today",
                      money2(fmvOf("flat", d)),
                      money2(fmvOf("slow", d)),
                      k ? pct(rateAt(growth, "slow", addMonths(d, -6), today)) : "–",
                      money2(fmvOf("recent", d)),
                    ];
                  })}
                />
              </Card>
            )}
          </>
        )}

        {/* Ledger */}
        <Card>
          <SectionHeader
            label="GRANTS"
            trailing={
              <span className="flex items-center gap-1.5 text-[11.5px] text-fx-ink-3" aria-live="polite">
                {saveState === "saving" && (<><Loader2 size={13} className="animate-spin" /> Saving…</>)}
                {saveState === "saved" && (<><CheckCircle2 size={13} className="text-fx-positive" /> Saved</>)}
                {saveState === "error" && (<><AlertCircle size={13} className="text-fx-negative" /> Couldn&rsquo;t save — try again</>)}
              </span>
            }
          />
          <Caption>
            One row per grant, as shown in your equity portal. Vesting is monthly after the cliff. Changes save when you leave a
            field.
          </Caption>

          {grants.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-fx-ink-2">No grants yet. Add one to see what it&rsquo;s worth.</p>
          ) : (
            <div className="-mx-1.5 overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse">
                <thead>
                  <tr className="border-b border-fx-line text-left text-[10.5px] font-medium text-fx-ink-3">
                    <th className="w-[22px] px-1.5 py-1.5" />
                    <th className="min-w-[160px] px-1.5 py-1.5 font-medium">Name</th>
                    <th className="w-[150px] px-1.5 py-1.5 font-medium">Grant / vest start</th>
                    <th className="w-[100px] px-1.5 py-1.5 font-medium">Shares</th>
                    <th className="w-[90px] px-1.5 py-1.5 font-medium">Strike $</th>
                    <th className="w-[70px] px-1.5 py-1.5 font-medium">Years</th>
                    <th className="w-[76px] px-1.5 py-1.5 font-medium">Cliff mo</th>
                    <th className="w-[70px] px-1.5 py-1.5 text-right font-medium">Vested</th>
                    <th className="w-[120px] px-1.5 py-1.5 text-right font-medium">If you leave now</th>
                    <th className="w-[130px] px-1.5 py-1.5 text-right font-medium">Fully vested, at exit</th>
                    <th className="w-[40px] px-1.5 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {grants.map((g, i) => (
                    <GrantRow
                      key={g.id}
                      grant={g}
                      index={i}
                      price={price}
                      fmvToday={f0}
                      today={today}
                      autoFocus={g.id === focusId}
                      onLiveChange={replaceGrant}
                      onCommit={commitGrant}
                      onDelete={setPendingDelete}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3">
            <button
              type="button"
              onClick={addGrant}
              disabled={adding}
              className="inline-flex items-center gap-1.5 rounded-[9px] bg-fx-accent px-3.5 py-2 text-[12.5px] font-semibold text-fx-surface transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Plus size={15} /> Add grant
            </button>
          </div>
        </Card>

        <p className="max-w-[80ch] text-[11.5px] text-fx-ink-3">
          Figures are before tax, dilution, or any discount for not being able to sell. Today&rsquo;s 409A is the strike of your most
          recent grant, since grants are priced at the company&rsquo;s 409A on their grant date. The 409A paths are scenarios drawn
          from the growth between your grants, not forecasts: a 409A can also fall.
        </p>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete grant?"
          description={`“${pendingDelete.name || "Grant"}” will be removed from your saved grants.`}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function historyPaths(recent: number): HistoryPath[] {
  return [
    { mode: "flat", label: "Stays at today’s", color: "var(--fx-ink-3)", dashed: false },
    { mode: "slow", label: "Growth keeps slowing (computed)", color: "var(--fx-ramp-2)", dashed: true },
    { mode: "recent", label: `Holds the recent rate (${pct(recent)}/yr)`, color: "var(--fx-ramp-4)", dashed: true },
  ];
}

/** Where the monthly gain from staying steps down, and why. */
function MonthlyRead({
  rows,
  grants,
  price,
  today,
  mode,
}: {
  rows: ReturnType<typeof monthlyGains>;
  grants: EquityGrant[];
  price: number;
  today: Date;
  mode: FmvMode;
}) {
  if (!rows.length) return null;
  const drops: ReactNode[] = [];
  for (let k = 1; k < rows.length && drops.length < 2; k++) {
    const prev = rows[k - 1].total, cur = rows[k].total;
    if (cur < prev * 0.9 && prev - cur > 50) {
      const monthDate = addMonths(today, k + 1);
      const done = grants.find((g) => {
        const e = grantEnd(g);
        return e && e > addMonths(monthDate, -2) && e <= monthDate;
      });
      drops.push(
        <span key={k}>
          {drops.length ? ", then " : ", dropping to "}
          <b>{usd(cur)}</b> from {monthYear(monthDate)}
          {done ? ` (when ${done.name || "a grant"} finishes)` : ""}
        </span>,
      );
    }
  }
  const zero = rows.findIndex((r, k) => k > 0 && (r.buyout ?? 0) < 1);
  return (
    <Read>
      At <b>{money2(price)}</b>, the next month of staying adds <b>{usd(rows[0].total)}</b>
      {drops}. A buyout gains <b>{usd(rows[0].buyout ?? 0)}</b> a month at first
      {mode === "flat" && zero > 0 ? (
        <>
          {" "}and nothing from <b>{monthYear(addMonths(today, zero + 1))}</b>: a grant whose strike equals today&rsquo;s 409A adds
          nothing to a buyout
        </>
      ) : null}
      .
    </Read>
  );
}

function YearlyRead({ rows, price, today }: { rows: ReturnType<typeof yearlyVesting>; price: number; today: Date }) {
  if (!rows.length) return null;
  const totals = rows.map((r) => r.total);
  const peak = totals.indexOf(Math.max(...totals));
  const next = rows.findIndex((r) => r.label === String(today.getFullYear() + 1));
  return (
    <Read>
      At <b>{money2(price)}</b>, vesting peaks in <b>{rows[peak].label.replace(" · now", "")}</b> at <b>{usd(totals[peak])}</b>
      {next >= 0 ? (
        <>
          . Next year adds <b>{usd(totals[next])}</b>. Without new grants it keeps falling as older grants finish
        </>
      ) : null}
      .
    </Read>
  );
}
