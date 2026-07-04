"use client";

import type { ReactNode } from "react";

export interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
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
