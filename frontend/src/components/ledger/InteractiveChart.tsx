"use client";

import { useCallback, useState, useId } from "react";
import { areaPath, linePath, yAt } from "./paths";

export interface ChartSeries {
  label: string;
  values: number[];
  color: string;
  /** Dashed lines read as comparisons; the solid one is the subject of the chart. */
  dash?: string;
  width?: number;
  fill?: boolean;
}

export interface TooltipRow {
  label: string;
  value: string;
  color: string;
}

const GRID_FRACTIONS = [0.08, 0.34, 0.6, 0.86];

export default function InteractiveChart({
  series,
  height,
  min,
  max,
  pointCount,
  tooltipTitle,
  tooltipRows,
  markerSeries = 0,
  ariaLabel,
}: {
  series: ChartSeries[];
  height: number;
  min: number;
  max: number;
  pointCount: number;
  /** Called for the hovered index; returning null hides the tooltip. */
  tooltipTitle: (index: number) => string;
  tooltipRows: (index: number) => TooltipRow[];
  /** Which series the dot rides on. */
  markerSeries?: number;
  ariaLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();

  const handleMove = useCallback(
    (clientX: number, target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      if (!rect.width || pointCount < 2) return;
      const raw = Math.round(((clientX - rect.left) / rect.width) * (pointCount - 1));
      setHover(Math.max(0, Math.min(pointCount - 1, raw)));
    },
    [pointCount]
  );

  const hoverPct = hover === null || pointCount < 2 ? 0 : (hover / (pointCount - 1)) * 100;
  const marker = series[markerSeries];
  const markerValue = hover !== null && marker ? marker.values[hover] : undefined;
  const markerTop =
    markerValue === undefined ? 0 : (yAt(markerValue, min, max, 300, 14) / 300) * height;
  // Past the midpoint the tooltip would overflow the right edge, so it flips.
  const flip = hover !== null && pointCount > 1 && hover / (pointCount - 1) > 0.58;

  return (
    <div
      className="relative cursor-crosshair touch-none"
      role="img"
      aria-label={ariaLabel}
      onMouseMove={(e) => handleMove(e.clientX, e.currentTarget)}
      onMouseLeave={() => setHover(null)}
      onTouchStart={(e) => handleMove(e.touches[0].clientX, e.currentTarget)}
      onTouchMove={(e) => handleMove(e.touches[0].clientX, e.currentTarget)}
      onTouchEnd={() => setHover(null)}
    >
      <svg
        viewBox="0 0 1000 300"
        preserveAspectRatio="none"
        className="block w-full overflow-visible"
        style={{ height }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--fx-accent)" stopOpacity="0.3" />
            <stop offset="1" stopColor="var(--fx-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {GRID_FRACTIONS.map((f) => (
          <line
            key={f}
            x1="0"
            y1={300 * f}
            x2="1000"
            y2={300 * f}
            stroke="var(--fx-line-2)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {series.map((s, i) =>
          s.fill && s.values.length > 1 ? (
            <path key={`fill-${i}`} d={areaPath(s.values, min, max)} fill={`url(#${gradientId})`} />
          ) : null
        )}
        {series.map((s, i) =>
          s.values.length > 1 ? (
            <path
              key={`line-${i}`}
              d={linePath(s.values, min, max)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width ?? 2.2}
              strokeDasharray={s.dash}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null
        )}
      </svg>

      {hover !== null && (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-fx-ink-3"
            style={{ left: `${hoverPct}%` }}
          />
          {markerValue !== undefined && (
            <div
              className="pointer-events-none absolute h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fx-accent"
              style={{ left: `${hoverPct}%`, top: markerTop }}
            />
          )}
          <div
            className="pointer-events-none absolute top-2 z-[5] min-w-[168px] rounded-xl border border-fx-line bg-fx-surface px-[13px] py-[11px] shadow-[0_8px_30px_-10px_rgb(0_0_0/0.35)]"
            style={
              flip
                ? { right: `calc(100% - ${hoverPct}% + 14px)` }
                : { left: `calc(${hoverPct}% + 14px)` }
            }
          >
            <div className="font-fx-mono text-[10.5px] font-medium leading-none tracking-[0.04em] text-fx-ink-2">
              {tooltipTitle(hover)}
            </div>
            {tooltipRows(hover).map((r) => (
              <div key={r.label} className="mt-[7px] flex items-center justify-between gap-4">
                <span className="flex items-center gap-[7px] text-[11.5px] text-fx-ink-2">
                  <span className="h-0.5 w-[13px]" style={{ background: r.color }} />
                  {r.label}
                </span>
                <span className="text-[12.5px] font-semibold text-fx-ink">{r.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
