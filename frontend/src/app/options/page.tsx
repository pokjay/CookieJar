"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Plus, Trash2, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  createOptionGrant,
  deleteOptionGrant,
  getOptionGrants,
  updateOptionGrant,
} from "@/lib/api";
import type { OptionGrant, OptionGrantPayload } from "@/lib/types";
import { Card, SectionHeader, SegmentedControl, StatTile } from "@/components/ledger/ui";
import ConfirmDialog from "@/components/ConfirmDialog";
import { PriceValueChart, VestingTimelineChart } from "@/components/options/OptionCharts";
import {
  computeTotals,
  grantColor,
  latest409a,
  priceCurve,
  spread,
  toISODate,
  usd,
  vestedFraction,
  vestingTimeline,
} from "@/components/options/model";

// The assumed price and chart range are "play with it" inputs, so they live in
// this browser only. The grants are stored in the database, and the 409A is
// derived from them (the latest grant's strike).
const EXPLORER_KEY = "options-explorer-v1";

type Mode = "all" | "vested";

interface Explorer {
  price: number;
  max: number;
  mode: Mode;
}

const DEFAULT_EXPLORER: Explorer = { price: 60, max: 150, mode: "all" };

function loadExplorer(): Explorer {
  try {
    const raw = localStorage.getItem(EXPLORER_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        price: typeof s.price === "number" ? s.price : DEFAULT_EXPLORER.price,
        max: typeof s.max === "number" ? s.max : DEFAULT_EXPLORER.max,
        mode: s.mode === "vested" ? "vested" : "all",
      };
    }
  } catch {
    // private mode / blocked storage: fall back to defaults
  }
  return DEFAULT_EXPLORER;
}

/** Keep values the backend accepts (it rejects negatives and zero-year vesting). */
function sanitize(g: OptionGrant): OptionGrantPayload {
  return {
    name: g.name.trim(),
    grant_date: g.grant_date || null,
    shares: Math.max(0, g.shares || 0),
    strike: Math.max(0, g.strike || 0),
    vesting_years: g.vesting_years > 0 ? g.vesting_years : 4,
    cliff_months: Math.max(0, Math.round(g.cliff_months || 0)),
  };
}

const samePayload = (a: OptionGrantPayload, b: OptionGrantPayload) =>
  JSON.stringify(a) === JSON.stringify(b);

type SaveState = "idle" | "saving" | "saved" | "error";

const INPUT =
  "w-full min-w-0 rounded-[8px] border border-fx-line bg-fx-surface-2 px-2 py-1.5 text-[13px] text-fx-ink " +
  "focus:border-fx-accent focus:outline-none focus:ring-2 focus:ring-fx-accent-soft";

// ── Grant row ────────────────────────────────────────────────────────────────

type Field = "name" | "grant_date" | "shares" | "strike" | "vesting_years" | "cliff_months";

const toDraft = (g: OptionGrant): Record<Field, string> => ({
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
  today,
  autoFocus,
  onLiveChange,
  onCommit,
  onDelete,
}: {
  grant: OptionGrant;
  index: number;
  price: number;
  today: Date;
  autoFocus: boolean;
  onLiveChange: (g: OptionGrant) => void;
  onCommit: (g: OptionGrant) => void;
  onDelete: (g: OptionGrant) => void;
}) {
  // Inputs keep their own text so "4." or an empty field can be typed through;
  // the parsed grant is pushed up on every keystroke so the charts follow live.
  const [draft, setDraft] = useState(() => toDraft(grant));

  const parse = (d: Record<Field, string>): OptionGrant => ({
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
      <td className={`${cell} fx-num text-right text-[13px]`}>{usd(spread(grant, price) * f)}</td>
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

export default function OptionsPage() {
  const [grants, setGrants] = useState<OptionGrant[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [explorer, setExplorer] = useState<Explorer>(DEFAULT_EXPLORER);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [pendingDelete, setPendingDelete] = useState<OptionGrant | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  // What the server last confirmed, so blurring an unchanged field is a no-op.
  const saved = useRef<Map<number, OptionGrantPayload>>(new Map());

  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    setExplorer(loadExplorer());
    getOptionGrants()
      .then((data) => {
        setGrants(data);
        saved.current = new Map(data.map((g) => [g.id, sanitize(g)]));
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

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

  const setPrice = (v: number) => {
    const price = Math.max(0, Number.isFinite(v) ? v : 0);
    updateExplorer(
      price > explorer.max ? { price, max: Math.ceil(price / 10) * 10 } : { price },
    );
  };

  const replaceGrant = (g: OptionGrant) =>
    setGrants((prev) => prev.map((x) => (x.id === g.id ? g : x)));

  async function commitGrant(g: OptionGrant) {
    replaceGrant(g);
    const payload = sanitize(g);
    const last = saved.current.get(g.id);
    if (last && samePayload(last, payload)) return;
    setSaveState("saving");
    try {
      const stored = await updateOptionGrant(g.id, payload);
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
      const created = await createOptionGrant({
        name: "New grant",
        grant_date: toISODate(today),
        shares: 1000,
        // A new grant is priced at the current 409A, which is the latest strike.
        strike: fmv || 10,
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
      await deleteOptionGrant(g.id);
      saved.current.delete(g.id);
      setGrants((prev) => prev.filter((x) => x.id !== g.id));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  const { price, max, mode } = explorer;
  const fmvSource = latest409a(grants);
  const fmv = fmvSource?.price ?? 0;
  const totals = useMemo(() => computeTotals(grants, price, today), [grants, price, today]);
  const curve = useMemo(
    () => priceCurve(grants, max, mode === "vested", today),
    [grants, max, mode, today],
  );
  const timeline = useMemo(() => vestingTimeline(grants, price), [grants, price]);
  const todayLabel = timeline.find((r) => r.t >= today.getTime())?.label ?? null;

  const chips = fmv > 0 ? ([["409A", fmv], ["2×", fmv * 2], ["3×", fmv * 3], ["5×", fmv * 5]] as const) : [];

  if (loading) {
    return (
      <div className="fx flex min-h-screen items-center justify-center">
        <p className="text-fx-ink-2">Loading…</p>
      </div>
    );
  }

  return (
    <div className="fx min-h-screen">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-[22px] px-5 py-5 pb-8">
        <div>
          <h1 className="text-[19px] font-semibold tracking-[-0.02em]">Options</h1>
          <p className="mt-[5px] max-w-[68ch] text-[12.5px] text-fx-ink-3">
            What your equity appreciation rights pay out at a share price you pick — shares × (price −
            strike), in US dollars, before tax. For exploring only: not counted in net worth.
          </p>
        </div>

        {loadError && (
          <Card>
            <p className="text-[12.5px] text-fx-negative">Couldn&rsquo;t load your grants. Refresh to try again.</p>
          </Card>
        )}

        {/* Assumed price */}
        <Card>
          <div className="grid gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:items-center">
            <div>
              <SectionHeader label="ASSUMED PRICE PER SHARE" />
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="fx-num text-[38px] leading-none">${price.toFixed(2)}</span>
                {fmv > 0 && (
                  <span className="fx-num text-[12px] text-fx-ink-3">{(price / fmv).toFixed(1)}× latest 409A</span>
                )}
              </div>
              <input
                type="range"
                min={0}
                max={max}
                step={0.5}
                value={price}
                onChange={(e) => setPrice(parseFloat(e.target.value))}
                aria-label="Assumed price per share"
                className="mt-4 w-full accent-[var(--fx-accent)]"
              />
              <div className="fx-num flex justify-between text-[11px] text-fx-ink-3">
                <span>$0</span>
                <span>${max}</span>
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
                      {label} · ${v.toFixed(2)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className="grid gap-1">
                <span className="text-[10.5px] text-fx-ink-3">Price</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className={`${INPUT} fx-num`}
                  value={price}
                  onChange={(e) => setPrice(parseFloat(e.target.value))}
                />
              </label>
              <div className="grid gap-1">
                <span className="text-[10.5px] text-fx-ink-3">Latest 409A</span>
                <span
                  className="fx-num rounded-[8px] border border-transparent px-2 py-1.5 text-[13px]"
                  title="The strike of your most recent grant — grants are priced at the 409A of their grant date"
                >
                  {fmvSource ? `$${fmv.toFixed(2)}` : "—"}
                </span>
                <span className="truncate text-[10.5px] text-fx-ink-3">
                  {fmvSource ? `from ${fmvSource.grant.name || "latest grant"}` : "add a dated grant"}
                </span>
              </div>
              <label className="grid gap-1">
                <span className="text-[10.5px] text-fx-ink-3">Chart up to</span>
                <input
                  type="number"
                  min={5}
                  step={5}
                  className={`${INPUT} fx-num`}
                  value={max}
                  onChange={(e) => {
                    const m = Math.max(5, parseFloat(e.target.value) || 150);
                    updateExplorer(price > m ? { max: m, price: m } : { max: m });
                  }}
                />
              </label>
            </div>
          </div>
        </Card>

        {/* Totals */}
        <div className="flex flex-wrap gap-2.5">
          <StatTile label="All granted" value={usd(totals.all)} color="var(--fx-accent)" sub="payout if fully vested" />
          <StatTile
            label="Vested today"
            value={usd(totals.vested)}
            sub={`${Math.round(totals.vestedShares).toLocaleString("en-US")} shares`}
          />
          <StatTile
            label="Still vesting"
            value={usd(totals.unvested)}
            sub={
              totals.nextVest
                ? `next vest ${totals.nextVest.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                : grants.length
                  ? "fully vested"
                  : undefined
            }
          />
        </div>

        {grants.length > 0 && (
          <>
            <Card>
              <SectionHeader
                label="VALUE BY SHARE PRICE"
                trailing={
                  <SegmentedControl
                    size="sm"
                    ariaLabel="Which shares to count"
                    value={mode}
                    onChange={(m) => updateExplorer({ mode: m })}
                    options={[
                      { value: "all", label: "All granted" },
                      { value: "vested", label: "Vested today" },
                    ]}
                  />
                }
              />
              <p className="-mt-1 mb-3 text-[12px] text-fx-ink-3">
                Each band is one grant. A grant adds nothing until the price passes its strike.
              </p>
              <PriceValueChart
                grants={grants}
                rows={curve}
                price={price}
                fmv={fmv}
                maxPrice={max}
                markerValue={mode === "vested" ? totals.vested : totals.all}
              />
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
                {grants.map((g, i) => (
                  <span key={g.id} className="inline-flex items-center gap-1.5">
                    <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: grantColor(i) }} />
                    {g.name || "Grant"}
                    <span className="fx-num text-fx-ink-3">${(g.strike || 0).toFixed(2)}</span>
                  </span>
                ))}
              </div>
            </Card>

            <Card>
              <SectionHeader label="VESTED VALUE OVER TIME" />
              <p className="-mt-1 mb-3 text-[12px] text-fx-ink-3">
                Month by month at ${price.toFixed(2)} per share, as each grant vests.
              </p>
              <VestingTimelineChart grants={grants} rows={timeline} todayLabel={todayLabel} />
            </Card>
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
          <p className="-mt-1 mb-3 text-[12px] text-fx-ink-3">
            One row per grant, as shown in your equity portal. Vesting is monthly after the cliff. Changes save
            when you leave a field.
          </p>

          {grants.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-fx-ink-2">
              No grants yet. Add one to see what it&rsquo;s worth.
            </p>
          ) : (
            <div className="-mx-1.5 overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse">
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
                    <th className="w-[110px] px-1.5 py-1.5 text-right font-medium">Value now</th>
                    <th className="w-[120px] px-1.5 py-1.5 text-right font-medium">Value at full</th>
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
          Figures are the payout — the spread between share price and strike — before tax, dilution, or any
          discount for not being able to sell. The 409A shown is the strike of your most recent grant, since
          grants are priced at the company&rsquo;s 409A on their grant date.
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
