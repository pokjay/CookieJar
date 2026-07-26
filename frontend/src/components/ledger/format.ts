const SHEKEL = "₪";
const MINUS = "−";

export function nis(value: number, masked = false): string {
  if (masked) return "••••••";
  const n = Math.round(Math.abs(value));
  return (value < 0 ? MINUS : "") + SHEKEL + n.toLocaleString("en-US");
}

/** Compact form for deltas and axis labels: ₪1.24M / ₪84k / ₪930. */
export function nisShort(value: number, masked = false): string {
  if (masked) return "••••••";
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : "";
  if (abs >= 1e6) return `${sign}${SHEKEL}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${sign}${SHEKEL}${Math.round(abs / 1e3)}k`;
  return `${sign}${SHEKEL}${Math.round(abs).toLocaleString("en-US")}`;
}

export function pct(value: number): string {
  if (!isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? MINUS : "";
  const decimals = Math.abs(value) >= 100 ? 0 : 1;
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

/** Colour for a signed change. `goodDirection` flips it for spend, where less is better. */
export function signColor(value: number, goodDirection: "up" | "down" = "up"): string {
  const oriented = goodDirection === "down" ? -value : value;
  if (oriented > 0) return "var(--fx-positive)";
  if (oriented < 0) return "var(--fx-negative)";
  return "var(--fx-ink-3)";
}

const SERIES = ["--fx-s1", "--fx-s2", "--fx-s3", "--fx-s4", "--fx-s5", "--fx-s6", "--fx-s7", "--fx-s8"];

/** Stable colour per category name, so a category keeps its colour across every chart. */
export function categoryColor(name: string | null | undefined): string {
  if (!name) return "var(--fx-ink-3)";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return `var(${SERIES[hash % SERIES.length]})`;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`;
}

export function monthLabelShort(year: number, month: number): string {
  return `${MONTHS[month]} '${String(year).slice(2)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function dayLabel(year: number, month: number, day: number): string {
  return `${WEEKDAYS[new Date(year, month, day).getDay()]} ${day} ${MONTHS[month]}`;
}
