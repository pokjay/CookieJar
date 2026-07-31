"use client";

import { useState } from "react";
import { Sparkline, StatTile } from "@/components/ledger/ui";
import { linePath, areaPath, paddedExtent } from "@/components/ledger/paths";
import { monthLabelShort, nis, nisShort, pct, signColor } from "@/components/ledger/format";
import { keyToYearMonth } from "@/components/spending/model";
import type { AccountsData } from "./accounts";

const PERSON_COLORS = ["var(--fx-accent)", "var(--fx-s2)", "var(--fx-s3)", "var(--fx-s5)"];

export default function AccountsByPerson({
  data,
  start,
  rangeLabel,
  compact,
}: {
  data: AccountsData;
  start: number;
  rangeLabel: string;
  compact: boolean;
}) {
  const [openPersons, setOpenPersons] = useState<Record<string, boolean>>(() =>
    data.persons.length ? { [data.persons[0]]: true } : {}
  );
  const [openAccount, setOpenAccount] = useState<number | null>(null);

  const netWorth = data.total[data.total.length - 1] ?? 0;
  const last = data.monthKeys.length - 1;

  return (
    <div className="flex flex-col gap-[11px]">
      {data.persons.map((person, i) => {
        const accounts = data.accounts.filter((a) => a.person === person);
        const total = accounts.reduce((s, a) => s + a.balance, 0);
        const then = accounts.reduce((s, a) => s + (a.values[start] ?? 0), 0);
        const open = !!openPersons[person];
        const color = PERSON_COLORS[i % PERSON_COLORS.length];

        return (
          <div
            key={person}
            className="overflow-hidden rounded-fx border border-fx-card-border bg-fx-card-bg shadow-fx"
          >
            <button
              type="button"
              data-testid={`account-group-${person}`}
              aria-expanded={open}
              onClick={() => setOpenPersons((p) => ({ ...p, [person]: !p[person] }))}
              className="flex w-full items-center gap-[13px] px-[17px] py-4 text-left"
            >
              <span
                className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px] bg-fx-surface-2 text-[13.5px] font-semibold"
                style={{ color }}
              >
                {person.charAt(0)}
              </span>
              <span className="min-w-0 flex-1 basis-[120px]">
                <span className="block text-[15px] font-semibold text-fx-ink">{person}</span>
                <span className="mt-1 block text-[11.5px] text-fx-ink-3">
                  {accounts.length} accounts · {Math.round((total / (netWorth || 1)) * 100)}% of
                  household
                </span>
              </span>
              <span className="flex-none text-right">
                <span
                  data-testid={`account-group-${person}-total`}
                  className="fx-num block text-xl text-fx-ink"
                >
                  {nis(total)}
                </span>
                <span
                  className="mt-1 block text-[11.5px]"
                  style={{ color: signColor(total - then) }}
                >
                  {pct(then ? ((total - then) / then) * 100 : 0)} · {rangeLabel}
                </span>
              </span>
              <span className="w-4 flex-none text-center text-[11px] text-fx-ink-3">
                {open ? "▲" : "▼"}
              </span>
            </button>

            {open &&
              accounts.map((account) => {
                const window = account.values.slice(start);
                const monthChange = account.balance - (account.values[last - 1] ?? account.balance);
                const rangeChange = account.balance - (account.values[start] ?? 0);
                const expanded = openAccount === account.id;
                const accentColor =
                  account.category === "Bank Account" || account.category === "Rainy Day Fund"
                    ? "var(--fx-accent)"
                    : "var(--fx-s2)";
                const [lo, hi] = paddedExtent(window, 0.1);
                const from = keyToYearMonth(data.monthKeys[start] ?? 0);
                const to = keyToYearMonth(data.monthKeys[last] ?? 0);

                return (
                  <div key={account.id} className="border-t border-fx-line-2">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpenAccount(expanded ? null : account.id)}
                      className={`flex w-full items-center gap-3 py-[13px] pl-6 pr-[17px] text-left ${
                        expanded ? "bg-fx-surface-2" : "hover:bg-fx-surface-2"
                      }`}
                    >
                      <span
                        className="h-[7px] w-[7px] flex-none rounded-sm"
                        style={{ background: accentColor }}
                      />
                      <span className="min-w-0 flex-1 basis-[120px]">
                        <span className="block truncate text-[13.5px] font-medium text-fx-ink">
                          {account.name}
                        </span>
                        <span className="mt-[5px] block font-fx-mono text-[10.5px] leading-none text-fx-ink-3">
                          ILS · {account.category}
                        </span>
                      </span>
                      {!compact && (
                        <span className="w-[76px] flex-none">
                          <Sparkline values={window} color={accentColor} height={26} />
                        </span>
                      )}
                      <span className="flex-none text-right">
                        <span className="fx-num block text-base text-fx-ink">
                          {nis(account.balance)}
                        </span>
                        <span
                          className="mt-1 block text-[11px]"
                          style={{ color: signColor(rangeChange) }}
                        >
                          {pct(
                            account.values[start]
                              ? (rangeChange / account.values[start]) * 100
                              : 0
                          )}
                        </span>
                      </span>
                      <span className="w-4 flex-none text-center text-[11px] text-fx-ink-3">
                        {expanded ? "▲" : "▼"}
                      </span>
                    </button>

                    {expanded && (
                      <div className="bg-fx-surface-2 pb-[18px] pl-6 pr-[17px] pt-0.5">
                        <div className="mb-3.5 flex flex-wrap gap-2.5">
                          <StatTile
                            label="Change · 1 month"
                            value={nisShort(monthChange)}
                            color={signColor(monthChange)}
                          />
                          <StatTile
                            label={`Change · ${rangeLabel}`}
                            value={nisShort(rangeChange)}
                            color={signColor(rangeChange)}
                          />
                          <StatTile
                            label="Share of net worth"
                            value={pct((account.balance / (netWorth || 1)) * 100).replace("+", "")}
                          />
                        </div>
                        <svg
                          viewBox="0 0 1000 220"
                          preserveAspectRatio="none"
                          aria-label={`${account.name} balance history`}
                          className="block h-[140px] w-full"
                        >
                          <defs>
                            <linearGradient
                              id={`acct-${account.id}`}
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop offset="0" stopColor={accentColor} stopOpacity="0.25" />
                              <stop offset="1" stopColor={accentColor} stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          <path
                            d={areaPath(window, lo, hi, 220, 12)}
                            fill={`url(#acct-${account.id})`}
                          />
                          <path
                            d={linePath(window, lo, hi, 220, 12)}
                            fill="none"
                            stroke={accentColor}
                            strokeWidth="2"
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                          />
                        </svg>
                        <div className="mt-[7px] flex justify-between font-fx-mono text-[10px] leading-none text-fx-ink-3">
                          <span>{monthLabelShort(from.year, from.month)}</span>
                          <span>{monthLabelShort(to.year, to.month)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
