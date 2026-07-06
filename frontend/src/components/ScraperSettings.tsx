"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getScraperStatus,
  initVault,
  listScraperAccounts,
  addScraperAccount,
  updateScraperAccount,
  deleteScraperAccount,
  ApiError,
} from "@/lib/api";
import type { ScraperAccount, ScraperStatus } from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";

// Isracard and Amex both authenticate with a national ID + 6-digit card number.
const ID_CARD6_PASSWORD_FIELDS = [
  { key: "id", label: "National ID" },
  { key: "card6Digits", label: "Card 6 Digits" },
  { key: "password", label: "Password", type: "password" },
];

// Visa Cal and Max both authenticate with a plain username/password.
const USERNAME_PASSWORD_FIELDS = [
  { key: "username", label: "Username" },
  { key: "password", label: "Password", type: "password" },
];

const PROVIDER_FIELDS: Record<string, { key: string; label: string; type?: string }[]> = {
  isracard: ID_CARD6_PASSWORD_FIELDS,
  visaCal: USERNAME_PASSWORD_FIELDS,
  max: USERNAME_PASSWORD_FIELDS,
  amex: ID_CARD6_PASSWORD_FIELDS,
};

const PROVIDER_LABELS: Record<string, string> = {
  isracard: "Isracard",
  visaCal: "Visa Cal",
  max: "Max",
  amex: "American Express",
};

// ── PasswordModal ──────────────────────────────────────────────────────────────

function PasswordModal({
  title,
  description,
  confirmLabel = "Continue",
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}) {
  const [pw, setPw] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-cj-surface border border-cj-border-strong rounded-xl shadow-2xl max-w-sm w-full p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-cj-text">{title}</h3>
          {description && <p className="text-sm text-cj-text-muted mt-1">{description}</p>}
        </div>
        <input
          type="password"
          autoFocus
          placeholder="Vault password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && pw && onConfirm(pw)}
          className="w-full bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text focus:outline-none focus:ring-2 focus:ring-cj-accent"
        />
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-cj-elevated hover:bg-cj-hover text-sm font-medium text-cj-text-3 transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!pw}
            onClick={() => onConfirm(pw)}
            className="px-4 py-2 rounded-lg bg-cj-accent hover:bg-cj-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AccountForm ────────────────────────────────────────────────────────────────

function AccountForm({
  providers,
  initial,
  onSave,
  onCancel,
}: {
  providers: string[];
  initial?: { title: string; provider: string };
  onSave: (title: string, provider: string, fields: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [provider, setProvider] = useState(initial?.provider ?? providers[0] ?? "");
  const [fields, setFields] = useState<Record<string, string>>({});

  const providerFields = PROVIDER_FIELDS[provider] ?? [];

  const canSave =
    title.trim() !== "" &&
    provider !== "" &&
    providerFields.every((f) => (fields[f.key] ?? "").trim() !== "");

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-cj-text-muted uppercase tracking-wide mb-1">
          Display Name
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. My Isracard"
          className="w-full bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text focus:outline-none focus:ring-2 focus:ring-cj-accent"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-cj-text-muted uppercase tracking-wide mb-1">
          Provider
        </label>
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setFields({});
          }}
          className="w-full bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text focus:outline-none focus:ring-2 focus:ring-cj-accent"
        >
          {providers.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p] ?? p}
            </option>
          ))}
        </select>
      </div>

      {providerFields.map((f) => (
        <div key={f.key}>
          <label className="block text-xs font-medium text-cj-text-muted uppercase tracking-wide mb-1">
            {f.label}
          </label>
          <input
            type={f.type ?? "text"}
            value={fields[f.key] ?? ""}
            onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
            className="w-full bg-cj-elevated border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text focus:outline-none focus:ring-2 focus:ring-cj-accent"
          />
        </div>
      ))}

      <div className="flex gap-3 justify-end pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-cj-elevated hover:bg-cj-hover text-sm font-medium text-cj-text-3 transition-colors"
        >
          Cancel
        </button>
        <button
          disabled={!canSave}
          onClick={() => onSave(title.trim(), provider, fields)}
          className="px-4 py-2 rounded-lg bg-cj-accent hover:bg-cj-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
        >
          Save Account
        </button>
      </div>
    </div>
  );
}

// ── ScraperSettings ────────────────────────────────────────────────────────────

type ModalState =
  | { kind: "init" }
  | { kind: "unlock" }
  | { kind: "add" }
  | { kind: "edit"; account: ScraperAccount }
  | { kind: "delete"; account: ScraperAccount };

export default function ScraperSettings() {
  const [status, setStatus] = useState<ScraperStatus | null>(null);
  const [accounts, setAccounts] = useState<ScraperAccount[] | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Vault password lives in a ref so it never causes re-renders and never reaches React state
  const vaultPwRef = useRef<string | null>(null);

  const flash = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
  };

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await getScraperStatus());
    } catch {
      // mock mode / unavailable — silently ignore
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const refreshAccounts = useCallback(async (pw: string) => {
    const list = await listScraperAccounts(pw);
    setAccounts(list);
  }, []);

  function apiError(e: unknown): string {
    if (e instanceof ApiError) {
      switch (e.status) {
        case 401:
          return "Wrong vault password.";
        case 404:
          return "Vault not found. Initialize it first.";
        case 409:
          return "A vault already exists.";
        case 429:
          return "Too many failed password attempts. Try again in a minute.";
        default:
          return e.message;
      }
    }
    return e instanceof Error ? e.message : String(e);
  }

  async function handleInit(pw: string) {
    setModal(null);
    setBusy(true);
    setError(null);
    try {
      await initVault(pw);
      flash("Vault created successfully.");
      await loadStatus();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock(pw: string) {
    setModal(null);
    setBusy(true);
    setError(null);
    try {
      const list = await listScraperAccounts(pw);
      vaultPwRef.current = pw;
      setAccounts(list);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(title: string, provider: string, fields: Record<string, string>) {
    if (!vaultPwRef.current) return;
    setModal(null);
    setBusy(true);
    setError(null);
    try {
      await addScraperAccount({
        title,
        provider,
        credential_fields: fields,
        db_password: vaultPwRef.current,
      });
      flash("Account added.");
      await refreshAccounts(vaultPwRef.current);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(
    uuid: string,
    title: string,
    provider: string,
    fields: Record<string, string>
  ) {
    if (!vaultPwRef.current) return;
    setModal(null);
    setBusy(true);
    setError(null);
    try {
      await updateScraperAccount(uuid, {
        title,
        provider,
        credential_fields: fields,
        db_password: vaultPwRef.current,
      });
      flash("Account updated.");
      await refreshAccounts(vaultPwRef.current);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(uuid: string) {
    if (!vaultPwRef.current) return;
    setModal(null);
    setBusy(true);
    setError(null);
    try {
      await deleteScraperAccount(uuid, vaultPwRef.current);
      flash("Account deleted.");
      await refreshAccounts(vaultPwRef.current);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  const vaultExists = status?.vault_available ?? false;
  const providers = status?.providers ?? Object.keys(PROVIDER_FIELDS);
  const unlocked = accounts !== null;

  return (
    <div className="space-y-5">
      {/* Modals */}
      {modal?.kind === "init" && (
        <PasswordModal
          title="Initialize Vault"
          description="Choose a strong password for your new KeePass vault. You will need it every time you manage accounts or sync."
          confirmLabel="Create Vault"
          onConfirm={handleInit}
          onCancel={() => setModal(null)}
        />
      )}
      {modal?.kind === "unlock" && (
        <PasswordModal
          title="Unlock Vault"
          description="Enter your vault password to view and manage bank accounts."
          confirmLabel="Unlock"
          onConfirm={handleUnlock}
          onCancel={() => setModal(null)}
        />
      )}
      {modal?.kind === "add" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setModal(null)} />
          <div className="relative bg-cj-surface border border-cj-border-strong rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-base font-semibold text-cj-text mb-4">Add Bank Account</h3>
            <AccountForm
              providers={providers}
              onSave={handleAdd}
              onCancel={() => setModal(null)}
            />
          </div>
        </div>
      )}
      {modal?.kind === "edit" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setModal(null)} />
          <div className="relative bg-cj-surface border border-cj-border-strong rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-base font-semibold text-cj-text mb-4">Edit Account</h3>
            <AccountForm
              providers={providers}
              initial={{ title: modal.account.title, provider: modal.account.provider }}
              onSave={(title, provider, fields) =>
                handleEdit(modal.account.uuid, title, provider, fields)
              }
              onCancel={() => setModal(null)}
            />
          </div>
        </div>
      )}
      {modal?.kind === "delete" && (
        <ConfirmDialog
          title="Delete account?"
          description={
            <>
              Remove <strong>{modal.account.title}</strong> from the vault? This cannot be undone.
            </>
          }
          confirmLabel="Delete"
          onConfirm={() => handleDelete(modal.account.uuid)}
          onCancel={() => setModal(null)}
        />
      )}

      {/* Feedback */}
      {error && <p className="text-sm text-cj-negative">{error}</p>}
      {success && <p className="text-sm text-cj-positive">{success}</p>}

      {/* Vault status row */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-cj-text-2">Vault Status</p>
          <p className="text-xs text-cj-text-faint mt-0.5">
            {vaultExists
              ? unlocked
                ? "Unlocked — vault is open"
                : "Initialized — enter password to manage accounts"
              : "No vault — initialize first"}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {!vaultExists && (
            <button
              disabled={busy}
              onClick={() => { setError(null); setModal({ kind: "init" }); }}
              className="px-4 py-2 rounded-lg bg-cj-accent hover:bg-cj-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
            >
              Init Vault
            </button>
          )}
          {vaultExists && !unlocked && (
            <button
              disabled={busy}
              onClick={() => { setError(null); setModal({ kind: "unlock" }); }}
              className="px-4 py-2 rounded-lg bg-cj-elevated hover:bg-cj-hover border border-cj-border-strong disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-cj-text-2 transition-colors"
            >
              {busy ? "Unlocking…" : "Unlock Vault"}
            </button>
          )}
          {unlocked && (
            <button
              onClick={() => {
                vaultPwRef.current = null;
                setAccounts(null);
              }}
              className="text-xs text-cj-text-faint hover:text-cj-text-muted transition-colors"
            >
              Lock vault
            </button>
          )}
        </div>
      </div>

      {/* Account list */}
      {unlocked && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-cj-text-muted uppercase tracking-wide">
              Bank Accounts ({accounts!.length})
            </p>
            <button
              disabled={busy}
              onClick={() => setModal({ kind: "add" })}
              className="px-3 py-1.5 rounded-lg bg-cj-accent hover:bg-cj-accent-hover disabled:opacity-40 text-xs font-medium text-white transition-colors"
            >
              + Add Account
            </button>
          </div>

          {accounts!.length === 0 ? (
            <p className="text-sm text-cj-text-faint">No accounts in vault yet. Add one to start syncing.</p>
          ) : (
            <div className="divide-y divide-cj-border">
              {accounts!.map((acct) => (
                <div key={acct.uuid} className="flex items-center justify-between py-3 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-cj-text-2 truncate">{acct.title}</p>
                    <p className="text-xs text-cj-text-faint mt-0.5">
                      {PROVIDER_LABELS[acct.provider] ?? acct.provider}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      disabled={busy}
                      onClick={() => setModal({ kind: "edit", account: acct })}
                      className="px-3 py-1.5 rounded-lg bg-cj-elevated hover:bg-cj-hover border border-cj-border-strong text-xs font-medium text-cj-text-3 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setModal({ kind: "delete", account: acct })}
                      className="px-3 py-1.5 rounded-lg bg-red-900/30 hover:bg-red-900/50 border border-red-800 text-xs font-medium text-red-300 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
