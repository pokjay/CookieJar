"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getScraperStatus, triggerSync } from "@/lib/api";
import type { ScraperStatus } from "@/lib/types";

// ── SyncModal ─────────────────────────────────────────────────────────────────

function SyncModal({
  onSync,
  onCancel,
  busy,
}: {
  onSync: (password: string, lookbackDays: number) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [pw, setPw] = useState("");
  const [days, setDays] = useState(30);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={!busy ? onCancel : undefined} />
      <div className="relative bg-cj-surface border border-cj-border-strong rounded-xl shadow-2xl max-w-sm w-full p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-cj-text">Sync Bank Transactions</h3>
          <p className="text-sm text-cj-text-muted mt-1">
            Enter your vault password to fetch transactions from all linked accounts.
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
            onKeyDown={(e) => e.key === "Enter" && pw && !busy && onSync(pw, days)}
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

        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-cj-elevated hover:bg-cj-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-cj-text-3 transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!pw || busy}
            onClick={() => onSync(pw, days)}
            className="px-4 py-2 rounded-lg bg-cj-accent hover:bg-cj-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
          >
            {busy ? "Starting…" : "Sync Now"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RunStatus ─────────────────────────────────────────────────────────────────

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
        <div key={`${acct.account}-${acct.company_id}`} className="flex items-center justify-between gap-2 text-xs">
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
      ))}
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

  async function handleSync(password: string, lookbackDays: number) {
    setBusy(true);
    setError(null);
    try {
      await triggerSync({ db_password: password, lookback_days: lookbackDays });
      setShowModal(false);
      await fetchStatus();
      startPolling();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("401") || /wrong|unauthorized/i.test(msg)) {
        setError("Wrong vault password.");
      } else if (msg.includes("409") || /running/i.test(msg)) {
        setError("A sync is already running.");
        setShowModal(false);
        await fetchStatus();
        startPolling();
      } else if (msg.includes("422") || /no accounts/i.test(msg)) {
        setError("No accounts in vault. Add accounts in Settings → Bank Accounts.");
        setShowModal(false);
      } else {
        setError(msg);
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
