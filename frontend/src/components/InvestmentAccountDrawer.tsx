"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { CreateAccountPayload } from "@/lib/types";

const ACCOUNT_TYPES = [
  { he: "חשבון השקעות פרטי", en: "Private Investment Account" },
  { he: "קרן השתלמות", en: "Hishtalmut Fund" },
  { he: 'פק"מ', en: "Fixed Deposit" },
  { he: "קרן כספית", en: "Money Market Fund" },
  { he: "קרן פנסיה מקיפה", en: "Comprehensive Pension" },
  { he: "קרן פנסיה משלימה", en: "Supplementary Pension" },
  { he: "ביטוח מנהלים", en: "Managers Insurance" },
  { he: "קופת גמל", en: "Provident Fund" },
  { he: "עובר ושב", en: "Bank Account" },
  { he: "חסכון לכל ילד", en: "Children's Savings" },
  { he: "קופת גמל להשקעה", en: "Investment Provident Fund" },
];

const ACCOUNT_CATEGORIES = [
  { he: "השקעות", en: "Investments" },
  { he: "קרן השתלמות", en: "Hishtalmut" },
  { he: "פנסיה", en: "Pension" },
  { he: "כרית בטחון", en: "Rainy Day Fund" },
  { he: "עובר ושב", en: "Bank Account" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateAccountPayload) => Promise<void>;
  persons: string[];
}

const empty = (): CreateAccountPayload => ({
  person: "",
  company: "",
  account_type: "",
  account_type_category: null,
  is_active: true,
  is_pension: false,
  deposit_management_fees: null,
  acc_management_fees: null,
  investment_track: null,
  monthly_deposit: null,
  account_number: null,
});

export default function InvestmentAccountDrawer({
  open,
  onClose,
  onSubmit,
  persons,
}: Props) {
  const [form, setForm] = useState<CreateAccountPayload>(empty());
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const firstInputRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (open) {
      setForm(empty());
      setErrors({});
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  function set<K extends keyof CreateAccountPayload>(k: K, v: CreateAccountPayload[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.person) errs.person = "Required";
    if (!form.company) errs.company = "Required";
    if (!form.account_type) errs.account_type = "Required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      await onSubmit(form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={[
          "fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        ].join(" ")}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={[
          "fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-cj-surface border-l border-cj-border",
          "flex flex-col shadow-2xl transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label="Add Investment Account"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cj-border flex-shrink-0">
          <h2 className="text-lg font-semibold text-cj-text">Add Account</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-cj-text-muted hover:text-cj-text hover:bg-cj-elevated transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form id="drawer-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Person */}
          <Field label="Person" error={errors.person}>
            <select
              ref={firstInputRef}
              value={form.person}
              onChange={(e) => set("person", e.target.value)}
              className={inputCls(!!errors.person)}
            >
              <option value="">Select person…</option>
              {persons.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>

          {/* Company */}
          <Field label="Company / Institution" error={errors.company}>
            <input
              type="text"
              value={form.company}
              onChange={(e) => set("company", e.target.value)}
              placeholder="e.g. Meitav, Harel"
              className={inputCls(!!errors.company)}
            />
          </Field>

          {/* Account Type */}
          <Field label="Account Type" error={errors.account_type}>
            <select
              value={form.account_type}
              onChange={(e) => set("account_type", e.target.value)}
              className={inputCls(!!errors.account_type)}
            >
              <option value="">Select type…</option>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.he} value={t.he}>{t.en}</option>
              ))}
            </select>
          </Field>

          {/* Category */}
          <Field label="Category">
            <select
              value={form.account_type_category ?? ""}
              onChange={(e) => set("account_type_category", e.target.value || null)}
              className={inputCls(false)}
            >
              <option value="">Select category…</option>
              {ACCOUNT_CATEGORIES.map((c) => (
                <option key={c.he} value={c.he}>{c.en}</option>
              ))}
            </select>
          </Field>

          {/* Account Number */}
          <Field label="Account Number">
            <input
              type="text"
              value={form.account_number ?? ""}
              onChange={(e) => set("account_number", e.target.value || null)}
              placeholder="Optional"
              className={inputCls(false)}
            />
          </Field>

          {/* Investment Track */}
          <Field label="Investment Track">
            <input
              type="text"
              value={form.investment_track ?? ""}
              onChange={(e) => set("investment_track", e.target.value || null)}
              placeholder="e.g. General, Aggressive Growth"
              className={inputCls(false)}
            />
          </Field>

          {/* Monthly Deposit */}
          <Field label="Monthly Deposit (₪)">
            <input
              type="number"
              min="0"
              step="any"
              value={form.monthly_deposit ?? ""}
              onChange={(e) => set("monthly_deposit", e.target.value ? Number(e.target.value) : null)}
              placeholder="0"
              className={inputCls(false)}
            />
          </Field>

          {/* Fees row */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Deposit Mgmt Fee (%)">
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.deposit_management_fees ?? ""}
                onChange={(e) =>
                  set("deposit_management_fees", e.target.value ? Number(e.target.value) : null)
                }
                placeholder="0.00"
                className={inputCls(false)}
              />
            </Field>
            <Field label="Acc. Mgmt Fee (%)">
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.acc_management_fees ?? ""}
                onChange={(e) =>
                  set("acc_management_fees", e.target.value ? Number(e.target.value) : null)
                }
                placeholder="0.00"
                className={inputCls(false)}
              />
            </Field>
          </div>

          {/* Toggles */}
          <div className="flex flex-col gap-3">
            <Toggle
              label="Active account"
              checked={form.is_active}
              onChange={(v) => set("is_active", v)}
            />
            <Toggle
              label="Pension account"
              checked={form.is_pension}
              onChange={(v) => set("is_pension", v)}
            />
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-cj-border flex-shrink-0 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl border border-cj-border-strong text-cj-text-3 text-sm font-medium hover:bg-cj-elevated transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl bg-cj-accent text-white text-sm font-medium hover:bg-cj-accent-hover disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Create Account"}
          </button>
        </div>
      </div>
    </>
  );
}

function inputCls(hasError: boolean) {
  return [
    "w-full bg-cj-elevated border rounded-xl px-3 py-2.5 text-sm text-cj-text placeholder-cj-text-faint",
    "focus:outline-none focus:ring-2 focus:ring-cj-accent/50 transition-colors",
    hasError ? "border-red-500" : "border-cj-border-strong focus:border-cj-border-strong",
  ].join(" ");
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-cj-text-muted uppercase tracking-wide">
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-cj-negative">{error}</p>}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-sm text-cj-text-3">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
          checked ? "bg-cj-accent" : "bg-cj-hover",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-6" : "translate-x-1",
          ].join(" ")}
        />
      </button>
    </label>
  );
}
