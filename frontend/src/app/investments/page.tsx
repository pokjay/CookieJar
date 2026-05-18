"use client";

import { useState, useEffect, useCallback } from "react";
import { Clock, Plus, Save, CheckCircle2, AlertCircle, ChevronDown } from "lucide-react";
import {
  getInvestmentAccounts,
  upsertInvestmentBalance,
  createInvestmentAccount,
} from "@/lib/api";
import type { InvestmentAccount, CreateAccountPayload } from "@/lib/types";
import InvestmentAccountDrawer from "@/components/InvestmentAccountDrawer";

function ageDays(iso: string | null): number {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never updated";
  const days = ageDays(iso);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function clockColor(iso: string | null): string {
  const days = ageDays(iso);
  if (days <= 60) return "text-cj-positive";
  if (days <= 180) return "text-cj-warning";
  return "text-cj-negative";
}

function formatAmount(n: number | null): string {
  if (n == null) return "";
  return new Intl.NumberFormat("en-IL", { maximumFractionDigits: 0 }).format(n);
}

interface AccountRowProps {
  account: InvestmentAccount;
  value: string;
  onChange: (v: string) => void;
  dirty: boolean;
}

function AccountRow({ account, value, onChange, dirty }: AccountRowProps) {
  const placeholder = account.latest_amount != null
    ? formatAmount(account.latest_amount)
    : "No balance yet";
  const color = clockColor(account.last_updated);

  return (
    <div
      className={[
        "flex items-center gap-4 px-5 py-4 rounded-2xl border transition-colors",
        dirty
          ? "bg-cj-accent/30 border-cj-accent/50"
          : "bg-cj-surface border-cj-border hover:border-cj-border-strong",
      ].join(" ")}
    >
      {/* Account label */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-cj-text truncate">
          {account.company} · {account.account_type}
        </p>
        <p className="text-xs text-cj-text-faint mt-0.5">
          {account.person}
          {account.account_number && (
            <span className="text-cj-text-faint"> · #{account.account_number}</span>
          )}
        </p>
      </div>

      {/* Last updated */}
      <div
        title={account.last_updated ? new Date(account.last_updated).toLocaleDateString() : "Never updated"}
        className={`flex items-center gap-1.5 text-xs flex-shrink-0 hidden sm:flex ${color}/80 cursor-default`}
      >
        <Clock size={13} className={color} />
        <span>{formatDate(account.last_updated)}</span>
      </div>

      {/* Balance input */}
      <div className="relative flex-shrink-0 w-36">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cj-text-faint text-sm select-none">
          ₪
        </span>
        <input
          type="number"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={[
            "w-full bg-transparent border rounded-xl pl-7 pr-6 py-2.5 text-sm text-right",
            "focus:outline-none focus:ring-2 focus:ring-cj-accent/50 transition-colors",
            dirty
              ? "border-cj-accent text-cj-text"
              : "border-cj-border-strong text-cj-text-muted placeholder:text-cj-text-faint focus:border-cj-border-strong focus:text-cj-text",
          ].join(" ")}
        />
      </div>
    </div>
  );
}

interface CategoryGroupProps {
  category: string;
  accounts: InvestmentAccount[];
  values: Record<number, string>;
  onChange: (id: number, v: string) => void;
}

function CategoryGroup({ category, accounts, values, onChange }: CategoryGroupProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-2xl border border-cj-border overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-3 bg-cj-surface hover:bg-cj-elevated/60 transition-colors"
      >
        <span className="text-xs font-semibold text-cj-text-muted uppercase tracking-widest">
          {category}
        </span>
        <ChevronDown
          size={15}
          className={`text-cj-text-faint transition-transform duration-200 ${expanded ? "" : "-rotate-90"}`}
        />
      </button>
      {expanded && (
        <div className="divide-y divide-cj-border/60">
          {accounts.map((account) => (
            <div key={account.id} className="px-2 py-1.5">
              <AccountRow
                account={account}
                value={values[account.id] ?? ""}
                onChange={(v) => onChange(account.id, v)}
                dirty={!!values[account.id]}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type SaveState = "idle" | "saving" | "success" | "error";

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

const UNCATEGORIZED = "Uncategorized";

export default function InvestmentsPage() {
  const [accounts, setAccounts] = useState<InvestmentAccount[]>([]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [updateDate, setUpdateDate] = useState<string>(todayISO());
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [persons, setPersons] = useState<string[]>([]);

  const load = useCallback(async () => {
    const data = await getInvestmentAccounts();
    setAccounts(data);
    setValues({});
    const uniquePersons = [...new Set(data.map((a) => a.person))].sort();
    setPersons(uniquePersons);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleChange(id: number, v: string) {
    setValues((prev) => ({ ...prev, [id]: v }));
    setSaveState("idle");
  }

  const dirtyAccounts = accounts.filter(
    (a) => values[a.id] !== undefined && values[a.id] !== ""
  );

  async function handleSave() {
    if (!dirtyAccounts.length) return;
    setSaveState("saving");
    try {
      await Promise.all(
        dirtyAccounts.map((a) =>
          upsertInvestmentBalance(a.id, Number(values[a.id]), updateDate)
        )
      );
      setSaveState("success");
      setTimeout(() => load(), 800);
    } catch {
      setSaveState("error");
    }
  }

  async function handleCreateAccount(payload: CreateAccountPayload) {
    await createInvestmentAccount(payload);
    await load();
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-cj-text-muted text-lg">Loading…</p>
      </div>
    );
  }

  // Only show active accounts
  const activeAccounts = accounts.filter((a) => a.is_active);

  // Group by person, then by category within each person
  const byPerson = activeAccounts.reduce<Record<string, InvestmentAccount[]>>((acc, a) => {
    (acc[a.person] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-cj-text">Investment Balances</h1>
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cj-elevated hover:bg-cj-hover text-cj-text-3 hover:text-cj-text text-sm font-medium transition-colors border border-cj-border-strong"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">Add Account</span>
        </button>
      </div>

      {/* Accounts grouped by person → category */}
      {Object.entries(byPerson).map(([person, personAccounts]) => {
        const byCategory = personAccounts.reduce<Record<string, InvestmentAccount[]>>((acc, a) => {
          const cat = a.account_type_category ?? UNCATEGORIZED;
          (acc[cat] ??= []).push(a);
          return acc;
        }, {});

        return (
          <div key={person} className="space-y-3">
            <h2 className="text-sm font-semibold text-cj-text-3 px-1">{person}</h2>
            <div className="space-y-2">
              {Object.entries(byCategory).map(([category, catAccounts]) => (
                <CategoryGroup
                  key={category}
                  category={category}
                  accounts={catAccounts}
                  values={values}
                  onChange={handleChange}
                />
              ))}
            </div>
          </div>
        );
      })}

      {activeAccounts.length === 0 && (
        <div className="text-center py-16 text-cj-text-faint">
          <p className="text-base">No investment accounts yet.</p>
          <p className="text-sm mt-1">Click &ldquo;Add Account&rdquo; to get started.</p>
        </div>
      )}

      {/* Save bar */}
      <div
        className={[
          "sticky bottom-6 transition-all duration-300",
          dirtyAccounts.length > 0 || saveState !== "idle" ? "opacity-100" : "opacity-0 pointer-events-none",
        ].join(" ")}
      >
        <div className="bg-cj-surface/95 backdrop-blur border border-cj-border rounded-2xl px-5 py-3 flex items-center gap-4 shadow-xl">
          {/* Date picker */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <label className="text-xs text-cj-text-faint hidden sm:block">Date</label>
            <input
              type="date"
              value={updateDate}
              max={todayISO()}
              onChange={(e) => setUpdateDate(e.target.value)}
              className="bg-cj-elevated border border-cj-border-strong rounded-lg px-2.5 py-1.5 text-sm text-cj-text-2 focus:outline-none focus:ring-2 focus:ring-cj-accent/50 focus:border-cj-accent transition-colors"
            />
          </div>

          {/* Status + save */}
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-sm text-cj-text-muted">
              {dirtyAccounts.length > 0
                ? `${dirtyAccounts.length} account${dirtyAccounts.length > 1 ? "s" : ""} changed`
                : saveState === "success"
                ? "Balances saved"
                : saveState === "error"
                ? "Save failed"
                : ""}
            </span>
            {saveState === "success" && (
              <CheckCircle2 size={18} className="text-cj-positive" />
            )}
            {saveState === "error" && (
              <AlertCircle size={18} className="text-cj-negative" />
            )}
            <button
              onClick={handleSave}
              disabled={saveState === "saving" || dirtyAccounts.length === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-cj-accent hover:bg-cj-accent-hover disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Save size={15} />
              {saveState === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* Drawer */}
      <InvestmentAccountDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSubmit={handleCreateAccount}
        persons={persons}
      />
    </div>
  );
}
