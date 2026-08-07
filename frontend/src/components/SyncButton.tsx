"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getScraperStatus, listScraperAccounts, triggerSync, ApiError } from "@/lib/api";
import type { ScraperAccount, ScraperStatus } from "@/lib/types";
import { PROVIDER_LABELS } from "@/lib/constants";

function apiErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.status) {
      case 401:
        return "Wrong vault password.";
      case 404:
        return "Vault not found. Initialize it in Settings → Bank Accounts.";
      case 429:
        return "Too many failed password attempts. Try again in a minute.";
      default:
        return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

// ── SyncModal ─────────────────────────────────────────────────────────────────

function SyncModal({
  onSync,
  onCancel,
  busy,
}: {
  onSync: (
    password: string,
    lookbackDays: number,
    accountUuids: string[] | undefined,
    extraDetails: boolean,
  ) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [pw, setPw] = useState("");
  const [days, setDays] = useState(30);
  // null until the user opts into picking accounts. Listing them needs the
  // vault password, and a wrong one spends the backend's failed-attempt budget
  // — so it happens on an explicit click, never per keystroke.
  const [accounts, setAccounts] = useState<ScraperAccount[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const picking = accounts !== null;
  // Sending undefined (rather than every uuid) keeps the default path on the
  // API's "all accounts" branch, so it behaves identically to before.
  const selection = picking ? [...selected] : undefined;
  const canSync = Boolean(pw) && !busy && (!picking || selected.size > 0);

  async function loadAccounts() {
    setLoadingAccounts(true);
    setAccountsError(null);
    try {
      const list = await listScraperAccounts(pw);
      setAccounts(list);
      setSelected(new Set(list.map((a) => a.uuid)));
    } catch (e: unknown) {
      setAccountsError(apiErrorMessage(e));
    } finally {
      setLoadingAccounts(false);
    }
  }

  function toggle(uuid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }

  // Default on, matching the backend's SyncPayload default. It used to be off
  // because a 429 during the extra-details fetch discarded the whole sync; the
  // scraper now paces that fetch, caps it with a time budget and absorbs the
  // 429, so leaving it on costs a slower sync — never the transactions.
  const [extraDetails, setExtraDetails] = useState(true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={!busy ? onCancel : undefined} />
      <div className="relative bg-cj-surface border border-cj-border-strong rounded-xl shadow-2xl max-w-sm w-full p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-cj-text">Sync Bank Transactions</h3>
          <p className="text-sm text-cj-text-muted mt-1">
            {picking
              ? "Choose which accounts to fetch transactions from."
              : "Enter your vault password to fetch transactions from all linked accounts."}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-cj-text-muted uppercase tracking-wide mb-1">
            Vault Password
          </label>
          <input
            type="password"
            autoFocus
            placeholder="Vault password"
            value={pw}
            disabled={busy}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && canSync && onSync(pw, days, selection, extraDetails)
            }
            className="w-full bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text focus:outline-none focus:ring-2 focus:ring-cj-accent disabled:opacity-50"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-cj-text-muted uppercase tracking-wide mb-1">
            Lookback (days)
          </label>
          <input
            type="number"
            min={1}
            max={90}
            value={days}
            disabled={busy}
            onChange={(e) => setDays(Math.min(90, Math.max(1, parseInt(e.target.value) || 1)))}
            className="w-full bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text focus:outline-none focus:ring-2 focus:ring-cj-accent disabled:opacity-50"
          />
          <p className="text-xs text-cj-text-faint mt-1">1–90 days</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-cj-text-muted uppercase tracking-wide mb-1">
            Accounts
          </label>

          {!picking ? (
            <button
              disabled={!pw || busy || loadingAccounts}
              onClick={loadAccounts}
              className="w-full text-left px-3 py-2 rounded-lg bg-cj-elevated border border-cj-border-strong hover:bg-cj-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm text-cj-text-3 transition-colors"
            >
              {loadingAccounts ? "Loading accounts…" : "All accounts — choose specific ones…"}
            </button>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-cj-text-faint">
              No accounts in vault. Add one in Settings → Bank Accounts.
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded-lg bg-cj-elevated border border-cj-border-strong divide-y divide-cj-border">
              {accounts.map((acct) => (
                <label
                  key={acct.uuid}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-cj-hover transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(acct.uuid)}
                    disabled={busy}
                    onChange={() => toggle(acct.uuid)}
                    className="shrink-0 accent-cj-accent"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-cj-text-2 truncate">{acct.title}</span>
                    <span className="block text-xs text-cj-text-faint">
                      {PROVIDER_LABELS[acct.provider] ?? acct.provider}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {!pw && !picking && (
            <p className="text-xs text-cj-text-faint mt-1">
              Enter the vault password first to list accounts.
            </p>
          )}
          {accountsError && <p className="text-xs text-cj-negative mt-1">{accountsError}</p>}
        </div>

        <div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={extraDetails}
              disabled={busy}
              onChange={(e) => setExtraDetails(e.target.checked)}
              className="mt-0.5 accent-cj-accent disabled:opacity-50"
            />
            <span>
              <span className="block text-sm text-cj-text">Fetch extra transaction details</span>
              <span className="block text-xs text-cj-text-faint mt-0.5">
                Adds the provider&apos;s own category to each transaction. Slow — one extra request
                per transaction, spaced out to stay under Isracard and Amex&apos;s rate limit — so
                it stops when it runs out of time and picks up where it left off next sync.
                Transactions are never at risk either way.
              </span>
            </span>
          </label>
        </div>

        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-cj-elevated hover:bg-cj-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-cj-text-3 transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!canSync}
            onClick={() => onSync(pw, days, selection, extraDetails)}
            className="px-4 py-2 rounded-lg bg-cj-accent hover:bg-cj-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
          >
            {busy
              ? "Starting…"
              : picking
              ? `Sync ${selected.size} of ${accounts.length}`
              : "Sync Now"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RunStatus ─────────────────────────────────────────────────────────────────

// How the bank-category pass went, in words rather than two raw numbers.
//
// The counts alone mislead at the ends of the range: a converged account reports
// 0 added and 0 missing, and "categories 0 added" reads as a failure when it
// actually means every transaction in the window already has one. A budget that
// never got started reports 0 added with a real backlog, where the added count
// is just noise. So each of the four states gets its own sentence.
export function categorySummary(added: number, missing: number): string {
  const categories = (n: number) => `${n} ${n === 1 ? "category" : "categories"}`;
  if (missing === 0) return added > 0 ? `${categories(added)} added` : "categories up to date";
  if (added === 0) return `${categories(missing)} missing`;
  return `${categories(added)} added · ${missing} missing`;
}

function RunStatus({ status }: { status: ScraperStatus }) {
  const run = status.last_run;
  if (!run) return null;

  const statusColors: Record<string, string> = {
    running: "text-cj-accent",
    success: "text-cj-positive",
    partial: "text-yellow-400",
    error: "text-cj-negative",
  };

  const statusLabels: Record<string, string> = {
    running: "Running…",
    success: "Done",
    partial: "Partial",
    error: "Error",
  };

  return (
    <div className="mt-3 p-3 rounded-lg bg-cj-elevated border border-cj-border text-sm space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-cj-text-2 font-medium">Last sync</span>
        <span className={`font-medium ${statusColors[run.status] ?? "text-cj-text-muted"}`}>
          {statusLabels[run.status] ?? run.status}
        </span>
      </div>
      {run.accounts.map((acct) => (
        <div key={`${acct.account}-${acct.company_id}`} className="space-y-0.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-cj-text-faint truncate">
              {acct.account} ({acct.company_id})
            </span>
            <span
              className={
                acct.status === "success"
                  ? "text-cj-positive"
                  : acct.status === "error"
                  ? "text-cj-negative"
                  : "text-cj-text-muted"
              }
            >
              {acct.status === "success"
                ? `${acct.transactions_imported} imported`
                : acct.error_type ?? acct.status}
            </span>
          </div>
          {/* The error_type above ("generic-error") is a code, not an
              explanation. When the scraper knows what actually went wrong it
              sends a sentence — show it, so the failure is actionable. */}
          {acct.status === "error" && acct.error_message && (
            <p className="text-xs text-cj-text-muted leading-snug pl-1 border-l-2 border-cj-negative/40 ml-0.5">
              {acct.error_message}
            </p>
          )}
          {/* A successful account can still be short of categories: the pass is
              budgeted and stops when the budget runs out. Without this the run
              reads as "done" while a backlog quietly persists. Null means the
              provider has no such pass at all, which is not a backlog of zero. */}
          {acct.enrichment_missing != null && (
            <p className="text-xs text-cj-text-muted leading-snug pl-1">
              {categorySummary(acct.enrichment_added ?? 0, acct.enrichment_missing)}
            </p>
          )}
        </div>
      ))}
      {run.accounts.some((a) => (a.enrichment_missing ?? 0) > 0) && (
        <p className="text-xs text-cj-text-muted leading-snug pt-1 border-t border-cj-border">
          Re-run with the same lookback to continue adding categories.
        </p>
      )}
    </div>
  );
}

// ── SyncButton ────────────────────────────────────────────────────────────────

export default function SyncButton() {
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ScraperStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await getScraperStatus();
      setStatus(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const s = await fetchStatus();
      if (s && !s.is_running) {
        stopPolling();
      }
    }, 3000);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => () => stopPolling(), []);

  async function handleSync(
    password: string,
    lookbackDays: number,
    accountUuids: string[] | undefined,
    extraDetails: boolean,
  ) {
    setBusy(true);
    setError(null);
    try {
      await triggerSync({
        db_password: password,
        lookback_days: lookbackDays,
        ...(accountUuids ? { account_uuids: accountUuids } : {}),
        additional_transaction_info: extraDetails,
      });
      setShowModal(false);
      await fetchStatus();
      startPolling();
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        switch (e.status) {
          case 401:
          case 429:
            setError(apiErrorMessage(e));
            break;
          case 409:
            setError("A sync is already running.");
            setShowModal(false);
            await fetchStatus();
            startPolling();
            break;
          case 422:
            // Either the vault is empty or the picked accounts went away
            // (deleted in another tab since the list was loaded). The backend's
            // detail distinguishes them; it names no account titles.
            setError(e.message || "No accounts to sync.");
            setShowModal(false);
            break;
          default:
            setError(e.message);
            setShowModal(false);
        }
      } else {
        setError(apiErrorMessage(e));
        setShowModal(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const isRunning = status?.is_running ?? false;
  const vaultAvailable = status?.vault_available ?? false;

  if (!vaultAvailable) return null;

  return (
    <div>
      {showModal && (
        <SyncModal
          busy={busy}
          onSync={handleSync}
          onCancel={() => !busy && setShowModal(false)}
        />
      )}

      <button
        disabled={isRunning || busy}
        onClick={() => {
          setError(null);
          setShowModal(true);
        }}
        className="px-4 py-2 rounded-lg bg-cj-accent hover:bg-cj-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
      >
        {isRunning ? "Syncing…" : "Sync Now"}
      </button>

      {error && <p className="mt-2 text-xs text-cj-negative">{error}</p>}

      {status && <RunStatus status={status} />}
    </div>
  );
}
