"use client";

import { useEffect, useState, useMemo, Fragment } from "react";
import {
  getCategoryHierarchy,
  getUncategorizedDescriptions,
  createCategoryMapping,
} from "@/lib/api";
import type { UncategorizedDescription } from "@/lib/types";

interface RowFormState {
  category: string;
  categoryInput: string;
  subcategory: string;
  subcategoryInput: string;
  submitting: boolean;
  error: string | null;
}

function emptyForm(): RowFormState {
  return {
    category: "",
    categoryInput: "",
    subcategory: "",
    subcategoryInput: "",
    submitting: false,
    error: null,
  };
}

export default function CategoryMappingPage() {
  const [hierarchy, setHierarchy] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<UncategorizedDescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDesc, setActiveDesc] = useState<string | null>(null);
  const [form, setForm] = useState<RowFormState>(emptyForm());

  const allCategories = useMemo(() => Object.keys(hierarchy), [hierarchy]);
  const subcategoriesForCategory = useMemo(
    () => (form.category === "__new__" ? [] : hierarchy[form.category] ?? []),
    [hierarchy, form.category]
  );

  const effectiveCategory =
    form.category === "__new__" ? form.categoryInput.trim() : form.category.trim();
  const effectiveSubcategory =
    form.subcategory === "__new__"
      ? form.subcategoryInput.trim()
      : form.subcategory.trim();

  async function load() {
    try {
      const [h, u] = await Promise.all([
        getCategoryHierarchy(),
        getUncategorizedDescriptions(),
      ]);
      setHierarchy(h);
      setRows(u);
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

  function openRow(desc: string) {
    setActiveDesc(desc);
    setForm(emptyForm());
  }

  function closeRow() {
    setActiveDesc(null);
    setForm(emptyForm());
  }

  function patchForm(patch: Partial<RowFormState>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function handleCategorySelect(e: React.ChangeEvent<HTMLSelectElement>) {
    patchForm({
      category: e.target.value,
      categoryInput: "",
      subcategory: "",
      subcategoryInput: "",
    });
  }

  function handleSubcategorySelect(e: React.ChangeEvent<HTMLSelectElement>) {
    patchForm({ subcategory: e.target.value, subcategoryInput: "" });
  }

  async function handleSave(description: string) {
    if (!effectiveCategory || !effectiveSubcategory) return;
    patchForm({ submitting: true, error: null });
    try {
      await createCategoryMapping({
        description,
        category: effectiveCategory,
        subcategory: effectiveSubcategory,
      });
      setActiveDesc(null);
      setForm(emptyForm());
      setLoading(true);
      await load();
    } catch (e) {
      patchForm({ submitting: false, error: String(e) });
    }
  }

  const canSave = effectiveCategory && effectiveSubcategory && !form.submitting;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-cj-text">Category Mapping</h1>
        <p className="text-cj-text-muted text-sm mt-1">
          Tap a row to assign a category and subcategory.
        </p>
      </div>

      {loading && (
        <p className="text-cj-text-muted text-sm animate-pulse">Loading…</p>
      )}
      {error && <p className="text-cj-negative text-sm">{error}</p>}

      {!loading && !error && rows.length === 0 && (
        <div className="bg-cj-positive/10 border border-cj-positive/30 rounded-xl px-6 py-5 text-cj-positive text-sm">
          All transactions are categorized!
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs text-cj-text-faint uppercase tracking-wide font-medium">
            {rows.length} uncategorized description{rows.length !== 1 ? "s" : ""}
          </p>
          <div className="rounded-xl border border-cj-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cj-border bg-cj-surface">
                  <th className="px-4 py-3 text-left text-xs font-medium text-cj-text-muted uppercase tracking-wide">
                    Description
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-cj-text-muted uppercase tracking-wide hidden sm:table-cell">
                    Count
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-cj-text-muted uppercase tracking-wide">
                    Total
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-cj-text-muted uppercase tracking-wide hidden md:table-cell">
                    Account
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-cj-text-muted uppercase tracking-wide hidden md:table-cell">
                    Last Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isActive = activeDesc === row.processed_description;
                  return (
                    <Fragment key={row.processed_description}>
                      <tr
                        onClick={() => isActive ? closeRow() : openRow(row.processed_description)}
                        className={[
                          "border-b border-cj-border/50 cursor-pointer transition-colors",
                          isActive
                            ? "bg-cj-accent/30 border-cj-accent"
                            : i % 2 === 0
                            ? "bg-cj-surface/30 hover:bg-cj-elevated/50"
                            : "hover:bg-cj-elevated/50",
                        ].join(" ")}
                      >
                        <td className="px-4 py-3 text-cj-text">
                          <span className="line-clamp-2 sm:line-clamp-1">
                            {row.processed_description}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-cj-text-muted hidden sm:table-cell">
                          {row.count}
                        </td>
                        <td className="px-4 py-3 text-right text-cj-text-3 tabular-nums">
                          ₪{Math.round(row.total_amount).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-cj-text-muted hidden md:table-cell">
                          {row.account}
                        </td>
                        <td className="px-4 py-3 text-cj-text-muted hidden md:table-cell">
                          {row.last_date}
                        </td>
                      </tr>

                      {isActive && (
                        <tr
                          key={`${row.processed_description}-form`}
                          className="border-b border-cj-accent bg-cj-accent/30"
                        >
                          <td colSpan={5} className="px-4 py-4">
                            <div className="flex flex-wrap gap-3 items-end">
                              {/* Category */}
                              <div className="flex flex-col gap-1 min-w-[160px] flex-1">
                                <label className="text-xs font-medium text-cj-text-muted uppercase tracking-wide">
                                  Category
                                </label>
                                <select
                                  value={form.category}
                                  onChange={handleCategorySelect}
                                  autoFocus
                                  className="bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text focus:outline-none focus:ring-2 focus:ring-cj-accent"
                                >
                                  <option value="">— select —</option>
                                  {allCategories.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                  ))}
                                  <option value="__new__">+ New category…</option>
                                </select>
                                {form.category === "__new__" && (
                                  <input
                                    type="text"
                                    placeholder="New category name"
                                    value={form.categoryInput}
                                    onChange={(e) => patchForm({ categoryInput: e.target.value })}
                                    autoFocus
                                    className="bg-cj-elevated border border-cj-accent rounded-lg px-3 py-2 text-sm text-cj-text placeholder-cj-text-faint focus:outline-none focus:ring-2 focus:ring-cj-accent"
                                  />
                                )}
                              </div>

                              {/* Subcategory */}
                              <div className="flex flex-col gap-1 min-w-[160px] flex-1">
                                <label className="text-xs font-medium text-cj-text-muted uppercase tracking-wide">
                                  Subcategory
                                </label>
                                <select
                                  value={form.subcategory}
                                  onChange={handleSubcategorySelect}
                                  disabled={!effectiveCategory}
                                  className="bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text focus:outline-none focus:ring-2 focus:ring-cj-accent disabled:opacity-40"
                                >
                                  <option value="">— select —</option>
                                  {subcategoriesForCategory.map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                  ))}
                                  <option value="__new__">+ New subcategory…</option>
                                </select>
                                {form.subcategory === "__new__" && (
                                  <input
                                    type="text"
                                    placeholder="New subcategory name"
                                    value={form.subcategoryInput}
                                    onChange={(e) => patchForm({ subcategoryInput: e.target.value })}
                                    autoFocus
                                    className="bg-cj-elevated border border-cj-accent rounded-lg px-3 py-2 text-sm text-cj-text placeholder-cj-text-faint focus:outline-none focus:ring-2 focus:ring-cj-accent"
                                  />
                                )}
                              </div>

                              {/* Actions */}
                              <div className="flex gap-2 pb-0.5">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSave(row.processed_description); }}
                                  disabled={!canSave}
                                  className="px-4 py-2 rounded-lg bg-cj-accent hover:bg-cj-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
                                >
                                  {form.submitting ? "Saving…" : "Save"}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); closeRow(); }}
                                  className="px-4 py-2 rounded-lg bg-cj-hover hover:bg-cj-elevated text-sm font-medium text-cj-text-3 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>

                            {form.error && (
                              <p className="mt-2 text-cj-negative text-xs">{form.error}</p>
                            )}
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
