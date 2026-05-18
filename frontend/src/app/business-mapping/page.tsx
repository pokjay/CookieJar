"use client";

import { useEffect, useState, useRef, Fragment } from "react";
import {
  getBusinessDescriptions,
  getUnmappedBusinessDescriptions,
  getUnmappedBusinessTransactions,
  createBusinessDescription,
  createBusinessMappings,
} from "@/lib/api";
import type {
  BusinessDescription,
  UnmappedBusinessDescription,
  UnmappedBusinessTransaction,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Combobox
// ---------------------------------------------------------------------------

interface ComboboxProps {
  options: BusinessDescription[];
  value: number; // 0 = unset
  disabled?: boolean;
  onCreate: (name: string) => Promise<BusinessDescription>;
  onSelect: (id: number) => void;
}

function BusinessCombobox({ options, value, disabled, onCreate, onSelect }: ComboboxProps) {
  const selectedLabel = options.find((o) => o.id === value)?.description ?? "";
  const [input, setInput] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep display in sync when the assigned value changes externally
  useEffect(() => {
    if (!open) setInput(selectedLabel);
  }, [selectedLabel, open]);

  const filtered = input.trim()
    ? options.filter((o) => o.description.toLowerCase().includes(input.toLowerCase()))
    : options;

  const exactMatch = options.find(
    (o) => o.description.toLowerCase() === input.trim().toLowerCase()
  );

  // Close on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setInput(selectedLabel);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [selectedLabel]);

  function handleFocus() {
    setOpen(true);
    setHighlighted(0);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInput(e.target.value);
    setOpen(true);
    setHighlighted(0);
  }

  async function commit(name: string) {
    const trimmed = name.trim();
    if (!trimmed) { setOpen(false); setInput(selectedLabel); return; }
    const match = options.find((o) => o.description.toLowerCase() === trimmed.toLowerCase());
    if (match) {
      onSelect(match.id);
      setInput(match.description);
      setOpen(false);
      return;
    }
    // Create new
    setCreating(true);
    try {
      const created = await onCreate(trimmed);
      onSelect(created.id);
      setInput(created.description);
    } finally {
      setCreating(false);
      setOpen(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered.length > 0 && highlighted < filtered.length) {
        const pick = filtered[highlighted];
        onSelect(pick.id);
        setInput(pick.description);
        setOpen(false);
      } else {
        commit(input);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setInput(selectedLabel);
    }
  }

  const showCreate = input.trim() && !exactMatch;

  return (
    <div ref={containerRef} className="relative w-full max-w-[200px]">
      <input
        ref={inputRef}
        type="text"
        value={creating ? "Adding…" : input}
        disabled={disabled || creating}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder="Type or search…"
        className={[
          "w-full bg-cj-elevated border rounded px-2 py-1 text-xs text-cj-text",
          "placeholder-cj-text-faint focus:outline-none focus:ring-1 focus:ring-cj-accent",
          "disabled:opacity-40",
          value ? "border-green-700" : "border-cj-border-strong",
        ].join(" ")}
      />
      {open && !creating && (
        <ul className="absolute z-50 top-full left-0 mt-0.5 w-full min-w-[180px] max-h-48 overflow-y-auto bg-cj-surface border border-cj-border-strong rounded shadow-xl text-xs">
          {filtered.map((o, idx) => (
            <li
              key={o.id}
              onPointerDown={(e) => { e.preventDefault(); onSelect(o.id); setInput(o.description); setOpen(false); }}
              className={[
                "px-3 py-2 cursor-pointer",
                idx === highlighted ? "bg-cj-accent text-white" : "text-cj-text-2 hover:bg-cj-elevated",
              ].join(" ")}
            >
              {o.description}
            </li>
          ))}
          {filtered.length === 0 && !showCreate && (
            <li className="px-3 py-2 text-cj-text-faint italic">No matches</li>
          )}
          {showCreate && (
            <li
              onPointerDown={(e) => { e.preventDefault(); commit(input); }}
              className="px-3 py-2 cursor-pointer text-cj-accent-text hover:bg-cj-elevated border-t border-cj-border-strong"
            >
              + Add &ldquo;{input.trim()}&rdquo;
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BusinessMappingPage() {
  const [unmappedDescs, setUnmappedDescs] = useState<UnmappedBusinessDescription[]>([]);
  const [bizDescs, setBizDescs] = useState<BusinessDescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeDesc, setActiveDesc] = useState<string | null>(null);
  const [txns, setTxns] = useState<UnmappedBusinessTransaction[]>([]);
  const [txnsLoading, setTxnsLoading] = useState(false);

  // assignments: unique_id → business_descriptions_id (0 = unset)
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [u, d] = await Promise.all([
        getUnmappedBusinessDescriptions(),
        getBusinessDescriptions(),
      ]);
      setUnmappedDescs(u);
      setBizDescs(d);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openDesc(desc: string) {
    if (activeDesc === desc) {
      setActiveDesc(null);
      setTxns([]);
      setAssignments({});
      setSaveError(null);
      return;
    }
    setActiveDesc(desc);
    setTxns([]);
    setAssignments({});
    setSaveError(null);
    setTxnsLoading(true);
    try {
      const rows = await getUnmappedBusinessTransactions(desc);
      setTxns(rows);
    } finally {
      setTxnsLoading(false);
    }
  }

  async function handleCreate(name: string): Promise<BusinessDescription> {
    const res = await createBusinessDescription(name);
    const entry: BusinessDescription = { id: res.id ?? 0, description: name };
    setBizDescs((prev) =>
      [...prev, entry].sort((a, b) => a.description.localeCompare(b.description))
    );
    return entry;
  }

  async function handleSave() {
    const items = Object.entries(assignments)
      .filter(([, id]) => id !== 0)
      .map(([unique_id, business_descriptions_id]) => ({ unique_id, business_descriptions_id }));
    if (items.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await createBusinessMappings(items);
      setActiveDesc(null);
      setTxns([]);
      setAssignments({});
      setLoading(true);
      await load();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const assignedCount = Object.values(assignments).filter((id) => id !== 0).length;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-cj-text">Business Mapping</h1>
        <p className="text-cj-text-muted text-sm mt-1">
          Map transaction descriptions (e.g. Wolt, Venmo) to specific business names.
        </p>
      </div>

      {loading && <p className="text-cj-text-muted text-sm animate-pulse">Loading…</p>}
      {error && <p className="text-cj-negative text-sm">{error}</p>}

      {!loading && !error && unmappedDescs.length === 0 && (
        <div className="bg-cj-positive/10 border border-cj-positive/30 rounded-xl px-6 py-5 text-cj-positive text-sm">
          All transactions are mapped to businesses!
        </div>
      )}

      {!loading && !error && unmappedDescs.length > 0 && (
        <section className="space-y-4">
          <p className="text-xs text-cj-text-faint uppercase tracking-wide font-medium">
            {unmappedDescs.length} description{unmappedDescs.length !== 1 ? "s" : ""} with unmapped transactions
          </p>

          <div className="rounded-xl border border-cj-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cj-border bg-cj-surface">
                  <th className="px-4 py-3 text-left text-xs font-medium text-cj-text-muted uppercase tracking-wide">
                    Description
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-cj-text-muted uppercase tracking-wide hidden sm:table-cell">
                    Unmapped
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-cj-text-muted uppercase tracking-wide">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {unmappedDescs.map((row, i) => {
                  const isActive = activeDesc === row.description;
                  return (
                    <Fragment key={row.description}>
                      <tr
                        onClick={() => openDesc(row.description)}
                        className={[
                          "border-b border-cj-border/50 cursor-pointer transition-colors",
                          isActive
                            ? "bg-cj-accent/30 border-cj-accent"
                            : i % 2 === 0
                            ? "bg-cj-surface/30 hover:bg-cj-elevated/50"
                            : "hover:bg-cj-elevated/50",
                        ].join(" ")}
                      >
                        <td className="px-4 py-3 text-cj-text font-medium">{row.description}</td>
                        <td className="px-4 py-3 text-right text-cj-text-muted hidden sm:table-cell">
                          {row.unmapped_count}
                        </td>
                        <td className="px-4 py-3 text-right text-cj-text-3 tabular-nums">
                          ₪{Math.round(row.total_amount).toLocaleString()}
                        </td>
                      </tr>

                      {isActive && (
                        <tr className="border-b border-cj-accent bg-cj-accent/20">
                          <td colSpan={3} className="px-4 py-4">
                            {txnsLoading ? (
                              <p className="text-cj-text-muted text-sm animate-pulse">Loading transactions…</p>
                            ) : txns.length === 0 ? (
                              <p className="text-cj-text-faint text-sm">No unmapped transactions.</p>
                            ) : (
                              <div className="rounded-lg border border-cj-border-strong overflow-visible mb-4">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-cj-elevated/60 border-b border-cj-border-strong">
                                      <th className="px-3 py-2 text-left text-cj-text-muted font-medium">Date</th>
                                      <th className="px-3 py-2 text-left text-cj-text-muted font-medium">Details</th>
                                      <th className="px-3 py-2 text-right text-cj-text-muted font-medium">Amount</th>
                                      <th className="px-3 py-2 text-left text-cj-text-muted font-medium">Business</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {txns.map((txn, ti) => (
                                      <tr
                                        key={txn.unique_id}
                                        className={[
                                          "border-b border-cj-border-strong/50",
                                          assignments[txn.unique_id]
                                            ? "bg-cj-positive/10"
                                            : ti % 2 === 0 ? "bg-cj-surface/20" : "",
                                        ].join(" ")}
                                      >
                                        <td className="px-3 py-2 text-cj-text-muted whitespace-nowrap">
                                          {txn.activity_date}
                                        </td>
                                        <td className="px-3 py-2 text-cj-text-3 max-w-[200px] truncate">
                                          {txn.processed_description}
                                        </td>
                                        <td className="px-3 py-2 text-right text-cj-text-3 tabular-nums whitespace-nowrap">
                                          ₪{Math.abs(txn.charged_amount).toLocaleString()}
                                        </td>
                                        <td className="px-3 py-2">
                                          <BusinessCombobox
                                            options={bizDescs}
                                            value={assignments[txn.unique_id] ?? 0}
                                            onCreate={handleCreate}
                                            onSelect={(id) =>
                                              setAssignments((prev) => ({ ...prev, [txn.unique_id]: id }))
                                            }
                                          />
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            <div className="flex gap-2 items-center">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSave(); }}
                                disabled={saving || assignedCount === 0}
                                className="px-4 py-2 rounded-lg bg-cj-accent hover:bg-cj-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
                              >
                                {saving
                                  ? "Saving…"
                                  : assignedCount > 0
                                  ? `Save ${assignedCount} mapping${assignedCount !== 1 ? "s" : ""}`
                                  : "Save"}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveDesc(null);
                                  setTxns([]);
                                  setAssignments({});
                                  setSaveError(null);
                                }}
                                className="px-4 py-2 rounded-lg bg-cj-hover hover:bg-cj-elevated text-sm font-medium text-cj-text-3 transition-colors"
                              >
                                Cancel
                              </button>
                              {saveError && <p className="text-cj-negative text-xs ml-2">{saveError}</p>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
