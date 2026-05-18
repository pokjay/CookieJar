export function formatCurrency(
  value: number,
  symbol = "\u20AA",
  decimalPlaces = 0
): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${symbol}${(value / 1_000).toFixed(decimalPlaces)}K`;
  }
  return `${symbol}${value.toFixed(decimalPlaces)}`;
}

export function formatCurrencyFull(value: number, symbol = "\u20AA"): string {
  return `${symbol}${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function formatPercentage(value: number, decimalPlaces = 1): string {
  return `${value.toFixed(decimalPlaces)}%`;
}

export function formatDelta(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}
