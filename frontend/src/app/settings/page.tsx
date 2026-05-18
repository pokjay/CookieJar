"use client";

import { useEffect, useState, useCallback } from "react";
import { useTheme } from "next-themes";
import {
  getSettings,
  saveSettings,
  getSettingsPersons,
  getSettingsAccounts,
  getCategoryMappingsCount,
  resetCategoryMappings,
  getBusinessMappingsCount,
  resetBusinessMappings,
} from "@/lib/api";
import type { AppSettings } from "@/lib/types";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-cj-surface border border-cj-border-strong rounded-xl shadow-2xl max-w-sm w-full p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-cj-text">{title}</h3>
          <p className="text-sm text-cj-text-muted mt-1">{description}</p>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-cj-elevated hover:bg-cj-hover text-sm font-medium text-cj-text-3 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-sm font-medium text-white transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_SETTINGS: AppSettings = {
  cfg_parent1: null,
  cfg_parent2: null,
  cfg_kids: [],
  sign_flipped_accounts: [],
  cash_flow_accounts: [],
  account_person_mapping: {},
};

function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(opt: string) {
    onChange(
      value.includes(opt) ? value.filter((x) => x !== opt) : [...value, opt]
    );
  }
  return (
    <div>
      <label className="block text-xs font-medium text-cj-text-muted uppercase tracking-wide mb-2">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const selected = value.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={[
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border",
                selected
                  ? "bg-cj-accent/20 border-cj-accent text-cj-accent-text"
                  : "bg-cj-elevated border-cj-border-strong text-cj-text-muted hover:text-cj-text-2 hover:border-cj-border-strong",
              ].join(" ")}
            >
              {opt}
            </button>
          );
        })}
        {options.length === 0 && (
          <span className="text-cj-text-faint text-sm">No options available</span>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-cj-surface rounded-xl border border-cj-border p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-cj-text">{title}</h2>
        {caption && (
          <p className="text-sm text-cj-text-muted mt-1">{caption}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [persons, setPersons] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [categoryCount, setCategoryCount] = useState<number | null>(null);
  const [businessCount, setBusinessCount] = useState<number | null>(null);
  const [resettingCategory, setResettingCategory] = useState(false);
  const [resettingBusiness, setResettingBusiness] = useState(false);
  const [categoryResetMsg, setCategoryResetMsg] = useState<string | null>(null);
  const [businessResetMsg, setBusinessResetMsg] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<null | "category" | "business">(null);

  const load = useCallback(async () => {
    try {
      const [s, p, a, catCount, bizCount] = await Promise.all([
        getSettings(),
        getSettingsPersons(),
        getSettingsAccounts(),
        getCategoryMappingsCount(),
        getBusinessMappingsCount(),
      ]);
      setSettings(s);
      setPersons(p);
      setAccounts(a);
      setCategoryCount(catCount.count);
      setBusinessCount(bizCount.count);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function patch(update: Partial<AppSettings>) {
    setSettings((s) => ({ ...s, ...update }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await saveSettings(settings);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function doResetCategories() {
    setConfirmDialog(null);
    setResettingCategory(true);
    setCategoryResetMsg(null);
    try {
      const res = await resetCategoryMappings();
      setCategoryResetMsg(`Deleted ${res.deleted} category mapping${res.deleted !== 1 ? "s" : ""}.`);
      setCategoryCount(0);
    } catch (e) {
      setCategoryResetMsg(`Error: ${String(e)}`);
    } finally {
      setResettingCategory(false);
    }
  }

  async function doResetBusiness() {
    setConfirmDialog(null);
    setResettingBusiness(true);
    setBusinessResetMsg(null);
    try {
      const res = await resetBusinessMappings();
      setBusinessResetMsg(`Deleted ${res.deleted} business mapping${res.deleted !== 1 ? "s" : ""}.`);
      setBusinessCount(0);
    } catch (e) {
      setBusinessResetMsg(`Error: ${String(e)}`);
    } finally {
      setResettingBusiness(false);
    }
  }

  const parent1Options = persons;
  const parent2Options = persons.filter((p) => p !== settings.cfg_parent1);
  const kidsOptions = persons.filter(
    (p) => p !== settings.cfg_parent1 && p !== settings.cfg_parent2
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-cj-text-muted text-lg">Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {confirmDialog === "category" && (
        <ConfirmDialog
          title="Reset all category mappings?"
          description={`This will permanently delete all ${categoryCount} category mapping${categoryCount !== 1 ? "s" : ""}. Transactions will become uncategorized again. This cannot be undone.`}
          confirmLabel="Yes, reset all"
          onConfirm={doResetCategories}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
      {confirmDialog === "business" && (
        <ConfirmDialog
          title="Reset all business mappings?"
          description={`This will permanently delete all ${businessCount} business mapping${businessCount !== 1 ? "s" : ""}. This cannot be undone.`}
          confirmLabel="Yes, reset all"
          onConfirm={doResetBusiness}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      <h1 className="text-2xl font-bold text-cj-text">Settings</h1>

      {/* Appearance */}
      <Section title="Appearance">
        <div>
          <label className="block text-xs font-medium text-cj-text-muted uppercase tracking-wide mb-2">
            Theme
          </label>
          <div className="flex gap-2">
            {(["dark", "light"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={[
                  "px-4 py-2 rounded-lg text-sm font-medium transition-colors border capitalize",
                  resolvedTheme === t
                    ? "bg-cj-accent/20 border-cj-accent text-cj-accent-text"
                    : "bg-cj-elevated border-cj-border text-cj-text-muted hover:text-cj-text hover:border-cj-border-strong",
                ].join(" ")}
              >
                {t === "dark" ? "🌙 Dark" : "☀️ Light"}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Family Members */}
      <Section title="Family Members">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-cj-text-muted uppercase tracking-wide mb-1">
              Parent 1
            </label>
            <select
              value={settings.cfg_parent1 ?? ""}
              onChange={(e) => {
                const v = e.target.value || null;
                patch({
                  cfg_parent1: v,
                  cfg_kids: settings.cfg_kids.filter(
                    (k) => k !== v && k !== settings.cfg_parent2
                  ),
                });
              }}
              className="w-full bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text focus:outline-none focus:ring-2 focus:ring-cj-accent"
            >
              <option value="">— none —</option>
              {parent1Options.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-cj-text-muted uppercase tracking-wide mb-1">
              Parent 2
            </label>
            <select
              value={settings.cfg_parent2 ?? ""}
              onChange={(e) => {
                const v = e.target.value || null;
                patch({
                  cfg_parent2: v,
                  cfg_kids: settings.cfg_kids.filter(
                    (k) => k !== settings.cfg_parent1 && k !== v
                  ),
                });
              }}
              className="w-full bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text focus:outline-none focus:ring-2 focus:ring-cj-accent"
            >
              <option value="">— none —</option>
              {parent2Options.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div>
            <MultiSelect
              label="Kids"
              options={kidsOptions}
              value={settings.cfg_kids}
              onChange={(v) => patch({ cfg_kids: v })}
            />
          </div>
        </div>
      </Section>

      {/* Sign-flipped Accounts */}
      <Section
        title="Sign-flipped Accounts"
        caption="Select accounts whose transaction amounts should have their sign flipped (e.g. bank accounts where debits are stored as negative numbers)."
      >
        <MultiSelect
          label="Accounts to flip sign"
          options={accounts}
          value={settings.sign_flipped_accounts}
          onChange={(v) => patch({ sign_flipped_accounts: v })}
        />
      </Section>

      {/* Cash Flow Bank Accounts */}
      <Section
        title="Cash Flow Bank Accounts"
        caption="Select the bank accounts whose transactions should be used to derive cash flow when data is missing from the cash flow table. Only bank accounts — not credit cards — since credit card expenses are already reflected as bank withdrawals."
      >
        <MultiSelect
          label="Bank accounts for cash flow"
          options={accounts}
          value={settings.cash_flow_accounts}
          onChange={(v) => patch({ cash_flow_accounts: v })}
        />
      </Section>

      {/* Account-to-Person Mapping */}
      <Section
        title="Account-to-Person Mapping"
        caption="Map each account to a person. Used to assign transactions to the correct person when deriving cash flow from manual transactions."
      >
        {accounts.length === 0 || persons.length === 0 ? (
          <p className="text-cj-text-faint text-sm">No accounts or persons available.</p>
        ) : (
          <div className="space-y-3">
            {accounts.map((acct) => (
              <div key={acct} className="flex items-center gap-3">
                <span className="flex-1 text-sm text-cj-text-3 truncate">{acct}</span>
                <select
                  value={settings.account_person_mapping[acct] ?? ""}
                  onChange={(e) =>
                    patch({
                      account_person_mapping: {
                        ...settings.account_person_mapping,
                        [acct]: e.target.value,
                      },
                    })
                  }
                  className="w-40 bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-1.5 text-sm text-cj-text focus:outline-none focus:ring-2 focus:ring-cj-accent"
                >
                  <option value="">— none —</option>
                  {persons.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Save Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 rounded-lg bg-cj-accent hover:bg-cj-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
        >
          {saving ? "Saving…" : "Save Settings"}
        </button>
        {saveSuccess && (
          <span className="text-cj-positive text-sm">Settings saved.</span>
        )}
        {saveError && (
          <span className="text-cj-negative text-sm">{saveError}</span>
        )}
      </div>

      {/* Mapping Management */}
      <Section
        title="Mapping Management"
        caption="View and reset category and business transaction mappings."
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 py-3 border-b border-cj-border">
            <div>
              <p className="text-sm font-medium text-cj-text-2">Category Mappings</p>
              <p className="text-xs text-cj-text-faint mt-0.5">
                {categoryCount === null ? "Loading…" : `${categoryCount} mapping${categoryCount !== 1 ? "s" : ""}`}
              </p>
              {categoryResetMsg && (
                <p className="text-xs text-cj-positive mt-1">{categoryResetMsg}</p>
              )}
            </div>
            <button
              onClick={() => setConfirmDialog("category")}
              disabled={resettingCategory || categoryCount === 0}
              className="px-4 py-2 rounded-lg bg-red-900/40 hover:bg-red-900/60 border border-red-800 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-red-300 transition-colors"
            >
              {resettingCategory ? "Resetting…" : "Reset"}
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 py-3">
            <div>
              <p className="text-sm font-medium text-cj-text-2">Business Mappings</p>
              <p className="text-xs text-cj-text-faint mt-0.5">
                {businessCount === null ? "Loading…" : `${businessCount} mapping${businessCount !== 1 ? "s" : ""}`}
              </p>
              {businessResetMsg && (
                <p className="text-xs text-cj-positive mt-1">{businessResetMsg}</p>
              )}
            </div>
            <button
              onClick={() => setConfirmDialog("business")}
              disabled={resettingBusiness || businessCount === 0}
              className="px-4 py-2 rounded-lg bg-red-900/40 hover:bg-red-900/60 border border-red-800 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-red-300 transition-colors"
            >
              {resettingBusiness ? "Resetting…" : "Reset"}
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}
