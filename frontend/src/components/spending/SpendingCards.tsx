"use client";

import { Card } from "@/components/ledger/ui";
import { categoryColor, dayLabel, nis, pct } from "@/components/ledger/format";
import type { Transaction } from "@/lib/types";
import type { SpendingModel } from "./model";
import { keyToYearMonth } from "./model";

export function CommittedVsChosen({
  transactions,
  committed,
  previousTransactions,
}: {
  transactions: Transaction[];
  committed: Set<string>;
  previousTransactions: Transaction[];
}) {
  const isCommitted = (t: Transaction) => committed.has(t.processed_description);
  const committedTxns = transactions.filter(isCommitted);
  const chosenTxns = transactions.filter((t) => !isCommitted(t));
  const committedSum = committedTxns.reduce((s, t) => s + t.charged_amount, 0);
  const chosenSum = chosenTxns.reduce((s, t) => s + t.charged_amount, 0);
  const total = committedSum + chosenSum;

  const previousByMerchant = new Map<string, number>();
  for (const t of previousTransactions) {
    if (!isCommitted(t)) continue;
    previousByMerchant.set(
      t.processed_description,
      (previousByMerchant.get(t.processed_description) ?? 0) + t.charged_amount
    );
  }

  const largest = [...committedTxns]
    .sort((a, b) => b.charged_amount - a.charged_amount)
    .slice(0, 6)
    .map((t) => {
      const before = previousByMerchant.get(t.processed_description) ?? 0;
      const unchanged = before === 0 || Math.abs(t.charged_amount - before) / Math.max(1, before) < 0.06;
      return {
        id: t.unique_id,
        merchant: t.processed_description,
        amount: t.charged_amount,
        note: unchanged
          ? "as usual"
          : t.charged_amount > before
            ? `up ${nis(t.charged_amount - before)}`
            : `down ${nis(before - t.charged_amount)}`,
        noteColor: unchanged
          ? "var(--fx-ink-3)"
          : t.charged_amount > before
            ? "var(--fx-negative)"
            : "var(--fx-positive)",
      };
    });

  const split = [
    {
      label: "Committed",
      value: committedSum,
      sub: `${committedTxns.length} charges · bills, insurance, subs`,
      color: "var(--fx-s3)",
    },
    {
      label: "Chosen",
      value: chosenSum,
      sub: `${chosenTxns.length} purchases · avg ${nis(chosenSum / (chosenTxns.length || 1))}`,
      color: "var(--fx-accent)",
    },
  ];

  return (
    <Card className="min-w-0 flex-1 basis-[300px]">
      <div className="mb-[3px] text-[12.5px] font-semibold">Committed vs chosen</div>
      <p className="mb-[15px] text-[11.5px] text-fx-ink-3">
        {Math.round((committedSum / (total || 1)) * 100)}% of this month was decided before it began
      </p>
      <div className="flex h-[11px] overflow-hidden rounded-full bg-fx-surface-2">
        <div
          style={{ background: "var(--fx-s3)", width: `${(committedSum / (total || 1)) * 100}%` }}
        />
        <div className="flex-1" style={{ background: "var(--fx-accent)" }} />
      </div>
      <div className="mt-3.5 flex flex-wrap gap-[18px]">
        {split.map((s) => (
          <div key={s.label} className="min-w-0 flex-1 basis-[110px]">
            <div className="flex items-center gap-[7px] text-[11.5px] text-fx-ink-2">
              <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </div>
            <div className="fx-num mt-1.5 text-[22px]">{nis(s.value)}</div>
            <div className="mt-1 text-[11.5px] text-fx-ink-3">{s.sub}</div>
          </div>
        ))}
      </div>
      {largest.length > 0 && (
        <div className="mt-[15px] flex flex-col gap-2.5 border-t border-fx-line-2 pt-[13px]">
          {largest.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2.5">
              <span className="truncate text-[12.5px] text-fx-ink">{s.merchant}</span>
              <span className="flex flex-none items-center gap-2.5">
                <span className="text-[11px]" style={{ color: s.noteColor }}>
                  {s.note}
                </span>
                <span className="text-[12.5px] font-semibold">{nis(s.amount)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function TopPurchases({
  transactions,
  monthKey: key,
}: {
  transactions: Transaction[];
  monthKey: number;
}) {
  const { year, month } = keyToYearMonth(key);
  const top = [...transactions].sort((a, b) => b.charged_amount - a.charged_amount).slice(0, 5);

  return (
    <Card className="min-w-0 flex-1 basis-[300px]">
      <div className="mb-[3px] text-[12.5px] font-semibold">5 biggest purchases</div>
      <p className="mb-[15px] text-[11.5px] text-fx-ink-3">
        Single largest charges in {new Date(year, month).toLocaleString("en-US", { month: "long", year: "numeric" })}
      </p>
      <div className="flex flex-col gap-[11px]">
        {top.map((t, i) => (
          <div key={t.unique_id} className="flex items-center gap-[11px]">
            <span className="w-3 flex-none font-fx-mono text-[11px] font-medium leading-none text-fx-ink-3">
              {i + 1}
            </span>
            <span
              className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] bg-fx-surface-2 text-[12.5px] font-semibold"
              style={{ color: categoryColor(t.category) }}
            >
              {t.processed_description.charAt(0)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold">
                {t.processed_description}
              </span>
              <span className="mt-[3px] block text-[11px] text-fx-ink-3">
                {t.category ? `${t.category}${t.subcategory ? ` · ${t.subcategory}` : ""}` : "uncategorised"}
                {" · "}
                {dayLabel(year, month, Number(t.activity_date.slice(8, 10)))}
              </span>
            </span>
            <span className="fx-num flex-none text-[17px]">{nis(t.charged_amount)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function DataHealthBanner({
  transactions,
  onReview,
}: {
  transactions: Transaction[];
  onReview: () => void;
}) {
  const uncategorized = transactions.filter((t) => !t.category);
  if (uncategorized.length === 0) return null;
  const sum = uncategorized.reduce((s, t) => s + t.charged_amount, 0);
  const total = transactions.reduce((s, t) => s + t.charged_amount, 0);

  return (
    <button
      type="button"
      onClick={onReview}
      className="flex w-full items-center gap-[11px] rounded-fx border border-fx-card-border border-l-2 border-l-fx-accent bg-fx-card-bg px-4 py-[13px] text-left shadow-fx"
    >
      <span className="font-fx-mono text-[10px] font-medium leading-none tracking-[0.1em] text-fx-accent">
        DATA HEALTH
      </span>
      <span className="min-w-0 flex-1 text-[12.5px] text-fx-ink-2">
        {uncategorized.length} transactions have no category this month — {nis(sum)}, about{" "}
        {Math.round((sum / (total || 1)) * 100)}% of the total. Every chart above is that much
        blurrier.
      </span>
      <span className="flex-none text-xs text-fx-accent">Review →</span>
    </button>
  );
}

export function StoryLine({
  model,
  monthKey: key,
  transactions,
  committed,
}: {
  model: SpendingModel;
  monthKey: number;
  transactions: Transaction[];
  committed: Set<string>;
}) {
  const day = model.coverageDay(key);
  const totals = model.categoryTotalsThrough(key, day);
  const ranked = [...totals.entries()]
    .filter(([name]) => name !== "Uncategorized")
    .sort((a, b) => b[1] - a[1]);
  const top = ranked[0];

  const mover = ranked
    .filter(([, amount]) => amount > 300)
    .map(([name, amount]) => {
      const average =
        [1, 2, 3].reduce((s, n) => s + model.categoryTotal(key - n, name), 0) / 3;
      return { name, change: average ? ((amount - average) / average) * 100 : 0 };
    })
    .sort((a, b) => b.change - a.change)[0];

  const committedSum = transactions
    .filter((t) => committed.has(t.processed_description))
    .reduce((s, t) => s + t.charged_amount, 0);

  return (
    <p className="m-0 text-sm leading-[1.65] text-fx-ink-2 text-pretty">
      Biggest slice is {top ? `${top[0]} at ${nis(top[1])}` : "—"}.{" "}
      {mover && `${mover.name} is the mover, ${pct(mover.change)} against its 3-month average. `}
      {nis(committedSum)} of the month was already committed before it started.
    </p>
  );
}
