"use client";

import type { ReactNode } from "react";
import { linePath, paddedExtent } from "./paths";

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`bg-fx-card-bg border border-fx-card-border rounded-fx shadow-fx ${
        padded ? "px-[18px] py-[17px]" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-fx-mono text-[10px] font-medium leading-none tracking-[0.14em] text-fx-ink-3">
      {children}
    </span>
  );
}

/** Section heading: label, hairline rule, optional trailing content. */
export function SectionHeader({
  label,
  trailing,
}: {
  label: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-[13px] flex flex-wrap items-center gap-[10px]">
      <SectionLabel>{label}</SectionLabel>
      <span className="h-px min-w-3 flex-1 bg-fx-line-2" />
      {trailing}
    </div>
  );
}

export interface Option<T extends string | number> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
  ariaLabel,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex gap-0.5 rounded-[9px] border border-fx-line bg-fx-surface-2 p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`rounded-[7px] font-semibold transition-colors ${
              size === "sm" ? "px-2.5 py-1.5 text-[11px]" : "px-[11px] py-[7px] text-[11.5px]"
            } ${
              active
                ? "bg-fx-surface text-fx-accent shadow-[0_1px_2px_rgb(0_0_0/0.09)]"
                : "text-fx-ink-2 hover:text-fx-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function PillGroup<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`rounded-full px-3 py-2 font-fx-mono text-[11.5px] font-medium leading-none tracking-[0.04em] transition-colors ${
              active ? "bg-fx-accent-soft text-fx-accent" : "text-fx-ink-2 hover:text-fx-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Sparkline({
  values,
  color,
  height = 26,
  className = "",
}: {
  values: number[];
  color: string;
  height?: number;
  className?: string;
}) {
  if (values.length < 2) return <span className={className} />;
  const [min, max] = paddedExtent(values, 0.05);
  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`block w-full ${className}`}
      style={{ height }}
    >
      <path
        d={linePath(values, min, max, height, 4, 100)}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function StatTile({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0 flex-1 basis-[130px] rounded-[11px] border border-fx-line-2 bg-fx-surface-2 px-[13px] py-[11px]">
      <div className="text-[10.5px] text-fx-ink-3">{label}</div>
      <div className="fx-num mt-1.5 text-[19px]" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-fx-ink-3">{sub}</div>}
    </div>
  );
}
