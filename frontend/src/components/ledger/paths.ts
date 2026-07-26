/** SVG path builders for the ledger charts.
 *
 * Every chart draws into a `0 0 1000 height` viewBox with
 * `preserveAspectRatio="none"`, so the x axis is always 0–1000 regardless of
 * rendered width and strokes need `vector-effect="non-scaling-stroke"`.
 */

export function yAt(value: number, min: number, max: number, height: number, pad: number): number {
  return height - pad - ((value - min) / (max - min || 1)) * (height - pad * 2);
}

export function linePath(
  values: number[],
  min: number,
  max: number,
  height = 300,
  pad = 14,
  width = 1000
): string {
  const n = values.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const x = n < 2 ? 0 : (i / (n - 1)) * width;
    const y = yAt(values[i], min, max, height, pad);
    d += `${i ? " L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

export function areaPath(
  values: number[],
  min: number,
  max: number,
  height = 300,
  pad = 14,
  width = 1000
): string {
  if (!values.length) return "";
  return `${linePath(values, min, max, height, pad, width)} L${width} ${height} L0 ${height} Z`;
}

export function extent(values: number[]): [number, number] {
  if (!values.length) return [0, 1];
  return [Math.min(...values), Math.max(...values)];
}

/** Pads an extent outward so the line never touches the top or bottom edge. */
export function paddedExtent(values: number[], fraction = 0.14): [number, number] {
  const [lo, hi] = extent(values);
  const pad = (hi - lo) * fraction || Math.abs(hi) * 0.1 || 1;
  return [lo - pad, hi + pad];
}
