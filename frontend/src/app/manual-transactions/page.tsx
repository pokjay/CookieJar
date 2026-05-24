"use client";

import { useEffect, useState, useRef } from "react";
import {
  getManualTransactionsMeta,
  getSettingsAccounts,
  checkDuplicate,
  createManualTransaction,
  bulkImportTransactions,
} from "@/lib/api";
import type { ManualTransactionPayload } from "@/lib/types";
import { Upload, PlusCircle, AlertTriangle, CheckCircle2, X } from "lucide-react";

// ─── types ────────────────────────────────────────────────────────────────────

interface Meta {
  currencies: string[];
  cash_flow_types: string[];
}

interface FormState {
  unique_id: string;
  account: string;
  activity_date: string;
  charged_amount: string;
  charged_currency: string;
  original_amount: string;
  original_currency: string;
  description: string;
  identifier: string;
  additional_info: string;
  charged_date: string;
  cash_flow_type: string;
}

interface CsvRow {
  // raw parsed fields
  unique_id?: string;
  account?: string;
  activity_date?: string;
  charged_amount?: string;
  charged_currency?: string;
  original_amount?: string;
  original_currency?: string;
  description?: string;
  identifier?: string;
  additional_info?: string;
  charged_date?: string;
  cash_flow_type?: string;
  // validation metadata
  _errors: string[];
  _duplicate: boolean;
  [key: string]: unknown;
}

// ─── constants ────────────────────────────────────────────────────────────────

const REQUIRED_CSV_COLS = ["account", "activity_date", "charged_currency", "original_amount", "original_currency", "description"];
const OPTIONAL_CSV_COLS = ["unique_id", "charged_amount", "identifier", "additional_info", "charged_date", "cash_flow_type"];
const ALL_CSV_COLS = [...REQUIRED_CSV_COLS, ...OPTIONAL_CSV_COLS];
// Optional columns the preview table always shows so users can edit them per row even when the CSV omitted them.
const ALWAYS_SHOW_COLS = new Set([...REQUIRED_CSV_COLS, "cash_flow_type"]);

// Per-column min-width for the editable preview cells. Tuned so the table can shrink
// below ~1100px without inputs collapsing. Narrow cells (currencies, cash_flow_type)
// shrink the most; description gets more room.
const CELL_MIN_WIDTH: Record<string, string> = {
  account: "min-w-[120px]",
  activity_date: "min-w-[120px]",
  charged_currency: "min-w-[72px]",
  original_currency: "min-w-[72px]",
  original_amount: "min-w-[100px]",
  charged_amount: "min-w-[100px]",
  description: "min-w-[160px]",
  identifier: "min-w-[120px]",
  additional_info: "min-w-[140px]",
  charged_date: "min-w-[120px]",
  cash_flow_type: "min-w-[110px]",
  unique_id: "min-w-[120px]",
};

type FixedInputKind = "account" | "currency" | "cash_flow_type" | "date" | "number" | "text";

const FIXED_INPUT_KIND: Record<string, FixedInputKind> = {
  account: "account",
  activity_date: "date",
  charged_date: "date",
  original_amount: "number",
  charged_amount: "number",
  original_currency: "currency",
  charged_currency: "currency",
  cash_flow_type: "cash_flow_type",
  description: "text",
  identifier: "text",
  additional_info: "text",
  unique_id: "text",
};

// "fixed" entries apply their value to every imported row.
type MappingEntry =
  | { kind: "csv"; csvCol: string }
  | { kind: "fixed"; value: string };

type Mapping = Record<string, MappingEntry>;

function isEntryFilled(entry: MappingEntry | undefined): boolean {
  if (!entry) return false;
  if (entry.kind === "csv") return !!entry.csvCol;
  return entry.value.trim() !== "";
}

const today = new Date().toISOString().split("T")[0];

function emptyForm(meta: Meta): FormState {
  return {
    unique_id: "",
    account: "",
    activity_date: today,
    charged_amount: "",
    charged_currency: meta.currencies[0] ?? "ILS",
    original_amount: "",
    original_currency: meta.currencies[0] ?? "ILS",
    description: "",
    identifier: "",
    additional_info: "",
    charged_date: "",
    cash_flow_type: meta.cash_flow_types.includes("expense") ? "expense" : (meta.cash_flow_types[0] ?? "expense"),
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function detectDelimiter(firstLine: string): string {
  // Pick the delimiter that produces the most columns
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const count = firstLine.split(d).length;
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delimiter = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter).map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const vals = splitLine(line, delimiter);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? "").trim().replace(/^"|"$/g, ""); });
    return obj;
  });
}

function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === "\t" || delimiter === "|" || delimiter === ";") {
    return line.split(delimiter);
  }
  // For comma: respect quoted fields
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(cur); cur = ""; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

function tryParseDate(val: string): boolean {
  if (!val) return false;
  return !isNaN(Date.parse(val.replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$2-$1")));
}

function stripThousands(val: string): string {
  return val.replace(/,/g, "");
}

function isNumeric(val: string): boolean {
  return val !== "" && !isNaN(Number(stripThousands(val)));
}

function validateCsvRow(row: Record<string, string>, cashFlowTypes: string[]): string[] {
  const errs: string[] = [];
  for (const col of REQUIRED_CSV_COLS) {
    if (!row[col]?.trim()) errs.push(`${col} is empty`);
  }
  if (row.activity_date && !tryParseDate(row.activity_date)) errs.push("activity_date is not a valid date");
  if (row.charged_date && !tryParseDate(row.charged_date)) errs.push("charged_date is not a valid date");
  if (row.original_amount && !isNumeric(row.original_amount)) errs.push("original_amount is not numeric");
  if (row.charged_amount && !isNumeric(row.charged_amount)) errs.push("charged_amount is not numeric");
  if (row.cash_flow_type && !cashFlowTypes.includes(row.cash_flow_type.trim())) {
    errs.push(`cash_flow_type must be one of: ${cashFlowTypes.join(", ")}`);
  }
  return errs;
}

function rowToPayload(row: CsvRow): ManualTransactionPayload {
  const orig = parseFloat(stripThousands(row.original_amount ?? "0"));
  const charged = row.charged_amount ? parseFloat(stripThousands(row.charged_amount)) : orig;
  return {
    unique_id: row.unique_id || undefined,
    account: row.account!,
    activity_date: row.activity_date!,
    charged_amount: charged,
    charged_currency: row.charged_currency!,
    original_amount: orig,
    original_currency: row.original_currency!,
    description: row.description!,
    identifier: row.identifier || undefined,
    additional_info: row.additional_info || undefined,
    charged_date: row.charged_date || undefined,
    cash_flow_type: row.cash_flow_type || "expense",
  };
}

// ─── sub-components ───────────────────────────────────────────────────────────

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-cj-text-muted uppercase tracking-wide">
        {label}{required && <span className="text-cj-negative ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  "bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text placeholder-cj-text-faint focus:outline-none focus:ring-2 focus:ring-cj-accent focus:border-transparent transition-colors";
const selectCls =
  "bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text focus:outline-none focus:ring-2 focus:ring-cj-accent focus:border-transparent transition-colors";

// ─── main page ────────────────────────────────────────────────────────────────

export default function ManualTransactionsPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"manual" | "csv">("manual");

  useEffect(() => {
    getManualTransactionsMeta()
      .then(setMeta)
      .catch((e) => setMetaError(String(e)));
  }, []);

  if (metaError) {
    return (
      <div className="p-6 text-cj-negative text-sm">Failed to load metadata: {metaError}</div>
    );
  }
  if (!meta) {
    return <div className="p-6 text-cj-text-muted text-sm animate-pulse">Loading…</div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-cj-text">Manual Transactions</h1>
        <p className="text-cj-text-muted text-sm mt-1">Insert transactions manually or import from a CSV file.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-cj-surface border border-cj-border rounded-xl w-fit">
        {(["manual", "csv"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              activeTab === tab
                ? "bg-cj-accent text-white shadow"
                : "text-cj-text-muted hover:text-cj-text hover:bg-cj-elevated",
            ].join(" ")}
          >
            {tab === "manual" ? <PlusCircle size={15} /> : <Upload size={15} />}
            {tab === "manual" ? "Manual Entry" : "CSV Import"}
          </button>
        ))}
      </div>

      {activeTab === "manual" ? (
        <ManualEntryTab meta={meta} />
      ) : (
        <CsvImportTab meta={meta} />
      )}
    </div>
  );
}

// ─── ManualEntryTab ───────────────────────────────────────────────────────────

function ManualEntryTab({ meta }: { meta: Meta }) {
  const [form, setForm] = useState<FormState>(() => emptyForm(meta));
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<ManualTransactionPayload | null>(null);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  function patch(patch: Partial<FormState>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function validate(): string[] {
    const errs: string[] = [];
    if (!form.account.trim()) errs.push("Account is required.");
    if (!form.description.trim()) errs.push("Description is required.");
    if (!form.original_amount.trim() || !isNumeric(form.original_amount))
      errs.push("Original Amount must be a valid number.");
    if (form.charged_amount.trim() && !isNumeric(form.charged_amount))
      errs.push("Charged Amount must be a valid number.");
    return errs;
  }

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);

    const payload: ManualTransactionPayload = {
      unique_id: form.unique_id.trim() || undefined,
      account: form.account.trim(),
      activity_date: form.activity_date,
      charged_amount: form.charged_amount.trim() ? parseFloat(form.charged_amount) : undefined,
      charged_currency: form.charged_currency,
      original_amount: parseFloat(form.original_amount),
      original_currency: form.original_currency,
      description: form.description.trim(),
      identifier: form.identifier.trim() || undefined,
      additional_info: form.additional_info.trim() || undefined,
      charged_date: form.charged_date || undefined,
      cash_flow_type: form.cash_flow_type,
    };

    try {
      const { is_duplicate } = await checkDuplicate(payload);
      setIsDuplicate(is_duplicate);
    } catch {
      setIsDuplicate(false);
    }
    setPreview(payload);
  }

  async function handleConfirm() {
    if (!preview) return;
    setSubmitting(true);
    try {
      await createManualTransaction(preview);
      setSuccess(true);
      setPreview(null);
      setIsDuplicate(false);
      setForm(emptyForm(meta));
    } catch (e) {
      setErrors([String(e)]);
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel() {
    setPreview(null);
    setIsDuplicate(false);
  }

  if (success) {
    return (
      <div className="rounded-xl border border-cj-positive/30 bg-cj-positive/10 px-6 py-8 flex flex-col items-center gap-4">
        <CheckCircle2 size={40} className="text-cj-positive" />
        <div className="text-center">
          <p className="text-cj-positive font-semibold text-lg">Transaction saved!</p>
          <p className="text-cj-positive/70 text-sm mt-1">The transaction was inserted successfully.</p>
        </div>
        <button
          onClick={() => setSuccess(false)}
          className="px-5 py-2 rounded-lg bg-cj-accent hover:bg-cj-accent-hover text-sm font-medium text-white transition-colors"
        >
          Add Another
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handlePreview} className="rounded-xl border border-cj-border bg-cj-surface/40 p-5 space-y-5">
        <h2 className="text-base font-semibold text-cj-text">New Transaction</h2>

        {/* Row 1: account + activity date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Account" required>
            <input
              className={inputCls}
              placeholder="e.g. Isracard-1234"
              value={form.account}
              onChange={(e) => patch({ account: e.target.value })}
            />
          </Field>
          <Field label="Activity Date" required>
            <input
              type="date"
              className={inputCls}
              value={form.activity_date}
              onChange={(e) => patch({ activity_date: e.target.value })}
            />
          </Field>
        </div>

        {/* Row 2: amounts + currencies */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="Original Amount" required>
            <input
              className={inputCls}
              placeholder="0.00"
              value={form.original_amount}
              onChange={(e) => patch({ original_amount: e.target.value })}
            />
          </Field>
          <Field label="Orig. Currency" required>
            <select
              className={selectCls}
              value={form.original_currency}
              onChange={(e) => patch({ original_currency: e.target.value })}
            >
              {meta.currencies.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Charged Amount">
            <input
              className={inputCls}
              placeholder="Defaults to original"
              value={form.charged_amount}
              onChange={(e) => patch({ charged_amount: e.target.value })}
            />
          </Field>
          <Field label="Charged Currency" required>
            <select
              className={selectCls}
              value={form.charged_currency}
              onChange={(e) => patch({ charged_currency: e.target.value })}
            >
              {meta.currencies.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        {/* Row 3: description + cash flow type */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Description" required>
            <input
              className={inputCls}
              placeholder="e.g. Supermarket purchase"
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </Field>
          <Field label="Cash Flow Type">
            <select
              className={selectCls}
              value={form.cash_flow_type}
              onChange={(e) => patch({ cash_flow_type: e.target.value })}
            >
              {meta.cash_flow_types.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
        </div>

        {/* Row 4: optional fields */}
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-cj-text-faint uppercase tracking-wide select-none hover:text-cj-text-3 transition-colors">
            Optional fields
          </summary>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Unique ID">
              <input
                className={inputCls}
                placeholder="Auto-generated if blank"
                value={form.unique_id}
                onChange={(e) => patch({ unique_id: e.target.value })}
              />
            </Field>
            <Field label="Identifier">
              <input
                className={inputCls}
                placeholder="e.g. REF123456"
                value={form.identifier}
                onChange={(e) => patch({ identifier: e.target.value })}
              />
            </Field>
            <Field label="Charged Date">
              <input
                type="date"
                className={inputCls}
                value={form.charged_date}
                onChange={(e) => patch({ charged_date: e.target.value })}
              />
            </Field>
            <Field label="Additional Info">
              <textarea
                className={`${inputCls} resize-none`}
                rows={2}
                placeholder="Any extra details"
                value={form.additional_info}
                onChange={(e) => patch({ additional_info: e.target.value })}
              />
            </Field>
          </div>
        </details>

        {/* Validation errors */}
        {errors.length > 0 && (
          <ul className="rounded-lg bg-red-900/20 border border-red-800 px-4 py-3 space-y-1">
            {errors.map((e, i) => (
              <li key={i} className="text-cj-negative text-sm flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0"><AlertTriangle size={14} /></span>
                {e}
              </li>
            ))}
          </ul>
        )}

        <button
          type="submit"
          className="px-5 py-2.5 rounded-lg bg-cj-accent hover:bg-cj-accent-hover text-sm font-semibold text-white transition-colors"
        >
          Preview Transaction
        </button>
      </form>

      {/* Preview panel */}
      {preview && (
        <div className="rounded-xl border border-cj-accent bg-cj-accent/30 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-cj-accent-text">Preview</h3>
            <button onClick={handleCancel} className="text-cj-text-faint hover:text-cj-text-3">
              <X size={16} />
            </button>
          </div>

          <PreviewTable row={preview} />

          {isDuplicate && (
            <div className="flex items-start gap-2 rounded-lg bg-cj-warning/10 border border-cj-warning/30 px-4 py-3">
              <AlertTriangle size={16} className="text-cj-warning flex-shrink-0 mt-0.5" />
              <p className="text-cj-warning text-sm">
                A transaction with the same date, account, amount, and description already exists. Are you sure?
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="px-5 py-2 rounded-lg bg-cj-accent hover:bg-cj-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors"
            >
              {submitting ? "Saving…" : "Confirm & Save"}
            </button>
            <button
              onClick={handleCancel}
              className="px-5 py-2 rounded-lg bg-cj-hover hover:bg-cj-elevated text-sm font-medium text-cj-text-3 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewTable({ row }: { row: ManualTransactionPayload }) {
  const fields: [string, string | number | undefined][] = [
    ["Date", row.activity_date],
    ["Account", row.account],
    ["Description", row.description],
    ["Original Amount", `${row.original_amount} ${row.original_currency}`],
    ["Charged Amount", `${row.charged_amount ?? row.original_amount} ${row.charged_currency}`],
    ["Cash Flow Type", row.cash_flow_type],
    ...(row.identifier ? [["Identifier", row.identifier] as [string, string]] : []),
    ...(row.charged_date ? [["Charged Date", row.charged_date] as [string, string]] : []),
    ...(row.additional_info ? [["Additional Info", row.additional_info] as [string, string]] : []),
    ...(row.unique_id ? [["Unique ID", row.unique_id] as [string, string]] : []),
  ];

  return (
    <div className="rounded-lg border border-cj-border overflow-hidden text-sm">
      <table className="w-full">
        <tbody>
          {fields.map(([label, value]) => (
            <tr key={label} className="border-b border-cj-border/60 last:border-0">
              <td className="px-4 py-2.5 text-cj-text-muted font-medium w-40">{label}</td>
              <td className="px-4 py-2.5 text-cj-text">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── CsvImportTab ─────────────────────────────────────────────────────────────

function autoDetectMapping(csvCols: string[]): Mapping {
  const mapping: Mapping = {};
  for (const target of ALL_CSV_COLS) {
    const exact = csvCols.find((c) => c.toLowerCase() === target.toLowerCase());
    if (exact) { mapping[target] = { kind: "csv", csvCol: exact }; continue; }
    // loose match: target contains col name or vice-versa
    const loose = csvCols.find(
      (c) =>
        c.toLowerCase().includes(target.toLowerCase()) ||
        target.toLowerCase().includes(c.toLowerCase())
    );
    if (loose) mapping[target] = { kind: "csv", csvCol: loose };
  }
  return mapping;
}

function applyMapping(
  rawRows: Record<string, string>[],
  mapping: Mapping
): Record<string, string>[] {
  return rawRows.map((row) => {
    const out: Record<string, string> = {};
    for (const [target, entry] of Object.entries(mapping)) {
      if (!entry) continue;
      if (entry.kind === "csv") {
        if (entry.csvCol && row[entry.csvCol] !== undefined) out[target] = row[entry.csvCol];
      } else {
        if (entry.value !== "") out[target] = entry.value;
      }
    }
    return out;
  });
}

function CsvImportTab({ meta }: { meta: Meta }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawRows, setRawRows] = useState<Record<string, string>[] | null>(null);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Mapping>({});
  const [showMapping, setShowMapping] = useState(false);
  const [rows, setRows] = useState<CsvRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: boolean; imported: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [knownAccounts, setKnownAccounts] = useState<string[]>([]);

  useEffect(() => {
    getSettingsAccounts()
      .then(setKnownAccounts)
      .catch(() => setKnownAccounts([]));
  }, []);

  function reset() {
    setRawRows(null);
    setCsvColumns([]);
    setColumnMapping({});
    setShowMapping(false);
    setRows(null);
    setParseError(null);
    setImportResult(null);
    setImportError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function validateAndSetRows(mapped: Record<string, string>[]) {
    const validated: CsvRow[] = mapped.map((r) => ({
      ...r,
      _errors: validateCsvRow(r, meta.cash_flow_types),
      _duplicate: false,
    }));
    setRows(validated);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      try {
        const parsed = parseCsv(text);
        if (!parsed.length) { setParseError("CSV is empty or has no data rows."); return; }

        const cols = Object.keys(parsed[0]);
        const missing = REQUIRED_CSV_COLS.filter((c) => !cols.includes(c));

        if (missing.length > 0) {
          // Show column mapper
          setRawRows(parsed);
          setCsvColumns(cols);
          setColumnMapping(autoDetectMapping(cols));
          setShowMapping(true);
        } else {
          validateAndSetRows(parsed);
        }
      } catch (err) {
        setParseError(`Failed to parse CSV: ${String(err)}`);
      }
    };
    reader.readAsText(file);
  }

  function handleApplyMapping() {
    if (!rawRows) return;
    const mapped = applyMapping(rawRows, columnMapping);
    setShowMapping(false);
    validateAndSetRows(mapped);
  }

  async function handleImport() {
    if (!rows) return;
    const validRows = rows.filter((r) => r._errors.length === 0);
    setImporting(true);
    setImportError(null);
    try {
      const result = await bulkImportTransactions({
        rows: validRows.map(rowToPayload),
      });
      setImportResult(result);
      setRows(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      setImportError(String(e));
    } finally {
      setImporting(false);
    }
  }

  function patchRow(idx: number, col: string, value: string) {
    setRows((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const row: CsvRow = { ...next[idx], [col]: value };
      const flat: Record<string, string> = {};
      for (const c of ALL_CSV_COLS) {
        const v = row[c];
        if (typeof v === "string") flat[c] = v;
      }
      row._errors = validateCsvRow(flat, meta.cash_flow_types);
      row._duplicate = false;
      next[idx] = row;
      return next;
    });
  }

  const numErrors = rows ? rows.filter((r) => r._errors.length > 0).length : 0;
  const numValid = rows ? rows.filter((r) => r._errors.length === 0).length : 0;
  const numDups = rows ? rows.filter((r) => r._duplicate).length : 0;

  return (
    <div className="space-y-6">
      <datalist id="manual-csv-accounts-list">
        {knownAccounts.map((a) => <option key={a} value={a} />)}
      </datalist>

      {/* Schema hint */}
      <div className="rounded-xl border border-cj-border bg-cj-surface/40 p-5 space-y-3 text-sm text-cj-text-muted">
        <p>
          <span className="text-cj-text-2 font-medium">Required columns: </span>
          {REQUIRED_CSV_COLS.map((c) => (
            <code key={c} className="mx-0.5 px-1.5 py-0.5 rounded bg-cj-elevated text-xs text-cj-accent-text">{c}</code>
          ))}
        </p>
        <p>
          <span className="text-cj-text-2 font-medium">Optional columns: </span>
          {OPTIONAL_CSV_COLS.map((c) => (
            <code key={c} className="mx-0.5 px-1.5 py-0.5 rounded bg-cj-elevated text-xs text-cj-text-muted">{c}</code>
          ))}
        </p>
        <p className="text-xs text-cj-text-faint">
          <code className="text-cj-text-muted">charged_amount</code> defaults to <code className="text-cj-text-muted">original_amount</code> when blank.{" "}
          <code className="text-cj-text-muted">cash_flow_type</code> values: {meta.cash_flow_types.join(", ")} (defaults to <em>expense</em>).
        </p>
      </div>

      {/* File picker */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file && fileInputRef.current) {
            const dt = new DataTransfer();
            dt.items.add(file);
            fileInputRef.current.files = dt.files;
            fileInputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }}
        className="rounded-xl border-2 border-dashed border-cj-border-strong hover:border-cj-accent bg-cj-surface/30 hover:bg-cj-accent/20 transition-all cursor-pointer p-10 flex flex-col items-center gap-3"
      >
        <Upload size={28} className="text-cj-text-faint" />
        <div className="text-center">
          <p className="text-cj-text-3 text-sm font-medium">Drop a CSV file here, or click to browse</p>
          <p className="text-cj-text-faint text-xs mt-1">.csv files only</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      {parseError && (
        <div className="rounded-lg bg-red-900/20 border border-red-800 px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={16} className="text-cj-negative flex-shrink-0 mt-0.5" />
          <p className="text-cj-negative text-sm">{parseError}</p>
        </div>
      )}

      {/* Column mapper */}
      {showMapping && rawRows && (
        <ColumnMapper
          rawRows={rawRows}
          csvColumns={csvColumns}
          mapping={columnMapping}
          currencies={meta.currencies}
          cashFlowTypes={meta.cash_flow_types}
          onChange={setColumnMapping}
          onApply={handleApplyMapping}
          onCancel={reset}
        />
      )}

      {/* Success */}
      {importResult && (
        <div className="rounded-xl border border-cj-positive/30 bg-cj-positive/10 px-6 py-6 flex items-center gap-4">
          <CheckCircle2 size={32} className="text-cj-positive flex-shrink-0" />
          <div>
            <p className="text-cj-positive font-semibold">Successfully imported {importResult.imported} transaction{importResult.imported !== 1 ? "s" : ""}!</p>
            <button onClick={reset} className="mt-2 text-xs text-cj-positive/70 hover:text-cj-positive underline">
              Import another file
            </button>
          </div>
        </div>
      )}

      {/* Preview table */}
      {rows && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-cj-text-3 font-medium">{rows.length} rows</span>
              {numErrors > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-red-900/40 border border-red-800 text-cj-negative text-xs">
                  {numErrors} error{numErrors !== 1 ? "s" : ""}
                </span>
              )}
              {numDups > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-cj-warning/10 border border-cj-warning/30 text-cj-warning text-xs">
                  {numDups} duplicate{numDups !== 1 ? "s" : ""}
                </span>
              )}
              {numErrors === 0 && (
                <span className="px-2 py-0.5 rounded-full bg-cj-positive/10 border border-cj-positive/30 text-cj-positive text-xs">
                  All valid
                </span>
              )}
            </div>
            <button onClick={reset} className="text-xs text-cj-text-faint hover:text-cj-text-3 underline">
              Clear
            </button>
          </div>

          {numErrors > 0 && (
            <div className="rounded-lg bg-red-900/20 border border-red-800 px-4 py-3 text-cj-negative text-sm">
              {numErrors} row{numErrors !== 1 ? "s have" : " has"} validation errors (shown in red). Edit cells below to fix, or re-upload.
            </div>
          )}
          {numDups > 0 && (
            <div className="rounded-lg bg-cj-warning/10 border border-cj-warning/30 px-4 py-3 text-cj-warning text-sm">
              {numDups} row{numDups !== 1 ? "s appear" : " appears"} to be duplicate{numDups !== 1 ? "s" : ""} (shown in orange).
            </div>
          )}

          <div className="rounded-xl border border-cj-border overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b border-cj-border bg-cj-surface">
                  <th className="px-3 py-2.5 text-left text-cj-text-muted font-medium w-6">#</th>
                  {ALL_CSV_COLS.filter((c) => ALWAYS_SHOW_COLS.has(c) || rows.some((r) => r[c] !== undefined)).map((col) => (
                    <th key={col} className="px-3 py-2.5 text-left text-cj-text-muted font-medium whitespace-nowrap">
                      {col}
                      {REQUIRED_CSV_COLS.includes(col) && <span className="text-cj-negative ml-0.5">*</span>}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-left text-cj-text-muted font-medium">Issues</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const hasError = row._errors.length > 0;
                  const isDup = !hasError && row._duplicate;
                  const rowCls = hasError
                    ? "bg-red-950/40 border-red-900/60"
                    : isDup
                    ? "bg-cj-warning/10 border-cj-warning/30"
                    : i % 2 === 0
                    ? "bg-cj-surface/20"
                    : "";
                  return (
                    <tr key={i} data-testid={`preview-row-${i}`} className={`border-b border-cj-border/40 ${rowCls}`}>
                      <td className="px-3 py-2 text-cj-text-faint align-top">{i + 1}</td>
                      {ALL_CSV_COLS.filter((c) => ALWAYS_SHOW_COLS.has(c) || rows.some((r) => r[c] !== undefined)).map((col) => (
                        <td
                          key={col}
                          data-testid={`preview-cell-${col}`}
                          className={`px-2 py-1.5 align-top ${CELL_MIN_WIDTH[col] ?? "min-w-[100px]"}`}
                        >
                          <EditableCell
                            target={col}
                            value={(row[col] as string) ?? ""}
                            currencies={meta.currencies}
                            cashFlowTypes={meta.cash_flow_types}
                            onChange={(v) => patchRow(i, col, v)}
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-cj-negative align-top">
                        {row._errors.join("; ") || (isDup ? "⚠ duplicate" : "")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {importError && (
            <div className="rounded-lg bg-red-900/20 border border-red-800 px-4 py-3 text-cj-negative text-sm">
              {importError}
            </div>
          )}

          <button
            onClick={handleImport}
            disabled={numErrors > 0 || importing || numValid === 0}
            className="px-5 py-2.5 rounded-lg bg-cj-accent hover:bg-cj-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors"
          >
            {importing ? "Importing…" : numErrors > 0 ? `Fix ${numErrors} error${numErrors !== 1 ? "s" : ""} first` : `Import ${numValid} transaction${numValid !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── ColumnMapper ─────────────────────────────────────────────────────────────

const FIXED_SENTINEL = "__fixed__";

function ColumnMapper({
  rawRows,
  csvColumns,
  mapping,
  currencies,
  cashFlowTypes,
  onChange,
  onApply,
  onCancel,
}: {
  rawRows: Record<string, string>[];
  csvColumns: string[];
  mapping: Mapping;
  currencies: string[];
  cashFlowTypes: string[];
  onChange: (m: Mapping) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const previewRows = rawRows.slice(0, 5);
  const missingRequired = REQUIRED_CSV_COLS.filter((f) => !isEntryFilled(mapping[f]));
  const canApply = missingRequired.length === 0;

  function setEntry(target: string, entry: MappingEntry | null) {
    const next: Mapping = { ...mapping };
    if (entry === null) delete next[target];
    else next[target] = entry;
    onChange(next);
  }

  function onSourceChange(target: string, raw: string) {
    if (raw === "") setEntry(target, null);
    else if (raw === FIXED_SENTINEL) {
      const existing = mapping[target];
      const value = existing && existing.kind === "fixed" ? existing.value : "";
      setEntry(target, { kind: "fixed", value });
    } else setEntry(target, { kind: "csv", csvCol: raw });
  }

  function onFixedValueChange(target: string, value: string) {
    setEntry(target, { kind: "fixed", value });
  }

  return (
    <div className="rounded-xl border border-cj-warning/40 bg-cj-warning/5 space-y-0 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-cj-warning/30 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-cj-warning">Map Your Columns</h3>
          <p className="text-cj-warning/70 text-xs mt-0.5">
            Your CSV columns don&apos;t match the expected format. For each field, map to a CSV column or enter a fixed value that applies to every row.
          </p>
        </div>
        <button onClick={onCancel} className="text-cj-text-faint hover:text-cj-text-3 flex-shrink-0 mt-0.5">
          <X size={16} />
        </button>
      </div>

      {/* Raw data preview */}
      <div className="px-5 py-4 border-b border-cj-warning/20 space-y-2">
        <p className="text-xs font-medium text-cj-text-muted uppercase tracking-wide">
          Your CSV — first {previewRows.length} rows
        </p>
        <div className="rounded-lg border border-cj-border overflow-x-auto">
          <table className="text-xs w-full min-w-[500px]">
            <thead>
              <tr className="border-b border-cj-border bg-cj-surface">
                {csvColumns.map((col) => (
                  <th key={col} className="px-3 py-2 text-left text-cj-text-3 font-medium whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i} className={`border-b border-cj-border/40 ${i % 2 === 0 ? "bg-cj-surface/20" : ""}`}>
                  {csvColumns.map((col) => (
                    <td key={col} className="px-3 py-1.5 text-cj-text-3 max-w-[180px] truncate">
                      {row[col] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mapping form */}
      <div className="px-5 py-4 space-y-3">
        <p className="text-xs font-medium text-cj-text-muted uppercase tracking-wide">Field Mapping</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
          {ALL_CSV_COLS.map((target) => {
            const isRequired = REQUIRED_CSV_COLS.includes(target);
            const entry = mapping[target];
            const filled = isEntryFilled(entry);
            const sourceValue =
              !entry ? "" : entry.kind === "fixed" ? FIXED_SENTINEL : entry.csvCol;
            return (
              <div key={target} className="flex items-start gap-3">
                <div className="w-40 flex-shrink-0 pt-1.5 flex items-center gap-1.5">
                  <span className={`text-xs font-medium ${filled ? "text-cj-text-3" : isRequired ? "text-cj-negative" : "text-cj-text-faint"}`}>
                    {target}
                  </span>
                  {isRequired && (
                    <span className="text-cj-negative text-xs">*</span>
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <select
                    value={sourceValue}
                    onChange={(e) => onSourceChange(target, e.target.value)}
                    className={[
                      "w-full bg-cj-elevated border rounded-lg px-2.5 py-1.5 text-xs text-cj-text focus:outline-none focus:ring-2 focus:ring-cj-accent transition-colors",
                      !filled && isRequired ? "border-red-700" : "border-cj-border-strong",
                    ].join(" ")}
                  >
                    <option value="">— skip —</option>
                    {csvColumns.length > 0 && (
                      <optgroup label="Map to CSV column">
                        {csvColumns.map((col) => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </optgroup>
                    )}
                    <option value={FIXED_SENTINEL}>— enter fixed value —</option>
                  </select>
                  {entry?.kind === "fixed" && (
                    <FixedValueInput
                      target={target}
                      value={entry.value}
                      currencies={currencies}
                      cashFlowTypes={cashFlowTypes}
                      onChange={(v) => onFixedValueChange(target, v)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!canApply && (
          <p className="text-xs text-cj-negative">
            Required fields still unmapped: {missingRequired.join(", ")}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            onClick={onApply}
            disabled={!canApply}
            className="px-4 py-2 rounded-lg bg-cj-accent hover:bg-cj-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors"
          >
            Apply Mapping
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-cj-hover hover:bg-cj-elevated text-sm font-medium text-cj-text-3 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── FixedValueInput ──────────────────────────────────────────────────────────

const fixedInputCls =
  "w-full bg-cj-elevated border border-cj-border-strong rounded-lg px-2.5 py-1.5 text-xs text-cj-text placeholder-cj-text-faint focus:outline-none focus:ring-2 focus:ring-cj-accent focus:border-transparent transition-colors";

function FixedValueInput({
  target,
  value,
  currencies,
  cashFlowTypes,
  onChange,
}: {
  target: string;
  value: string;
  currencies: string[];
  cashFlowTypes: string[];
  onChange: (v: string) => void;
}) {
  const kind: FixedInputKind = FIXED_INPUT_KIND[target] ?? "text";

  if (kind === "currency") {
    return (
      <select className={fixedInputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— pick a currency —</option>
        {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }
  if (kind === "cash_flow_type") {
    return (
      <select className={fixedInputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— pick a type —</option>
        {cashFlowTypes.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    );
  }
  if (kind === "account") {
    return (
      <input
        list="manual-csv-accounts-list"
        className={fixedInputCls}
        placeholder="Pick an existing account or type a new one"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (kind === "date") {
    return (
      <input
        type="date"
        className={fixedInputCls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (kind === "number") {
    return (
      <input
        type="number"
        step="any"
        className={fixedInputCls}
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      type="text"
      className={fixedInputCls}
      placeholder={`Value for every row`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ─── EditableCell ─────────────────────────────────────────────────────────────

// Read-only in the preview to avoid surprise: unique_id is auto-generated server-side,
// and charged_amount falls back to original_amount when empty.
const READONLY_PREVIEW_COLS = new Set(["unique_id", "charged_amount"]);

const cellInputCls =
  "w-full bg-cj-elevated/60 border border-cj-border rounded px-2 py-1 text-xs text-cj-text placeholder-cj-text-faint focus:outline-none focus:ring-1 focus:ring-cj-accent focus:border-cj-accent transition-colors";

function EditableCell({
  target,
  value,
  currencies,
  cashFlowTypes,
  onChange,
}: {
  target: string;
  value: string;
  currencies: string[];
  cashFlowTypes: string[];
  onChange: (v: string) => void;
}) {
  if (READONLY_PREVIEW_COLS.has(target)) {
    return (
      <span className="block px-2 py-1 text-cj-text-faint max-w-[160px] truncate">
        {value || <span className="italic">auto</span>}
      </span>
    );
  }

  const kind: FixedInputKind = FIXED_INPUT_KIND[target] ?? "text";

  if (kind === "currency") {
    const invalid = !!value && !currencies.includes(value);
    return (
      <select
        className={`${cellInputCls} ${invalid ? "border-cj-negative ring-1 ring-cj-negative/40" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {!currencies.includes(value) && <option value={value}>{value || "—"}</option>}
        {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }
  if (kind === "cash_flow_type") {
    const invalid = !!value && !cashFlowTypes.includes(value);
    return (
      <select
        className={`${cellInputCls} ${invalid ? "border-cj-negative ring-1 ring-cj-negative/40" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {!cashFlowTypes.includes(value) && <option value={value}>{value || "—"}</option>}
        {cashFlowTypes.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    );
  }
  if (kind === "account") {
    return (
      <input
        list="manual-csv-accounts-list"
        className={cellInputCls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  // dates and numbers stay as text inputs so non-ISO dates and thousand-separated numbers
  // from the original CSV survive editing without being silently dropped by the browser.
  return (
    <input
      type="text"
      className={cellInputCls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
