/** Indices of the labels worth printing on an x-axis of `count` points.
 *
 * Evenly stepped from the first point, always ending on the last one. When the
 * last step lands too close to the end, the label before it is dropped so the
 * two don't collide.
 */
export function tickIndices(count: number, target: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const step = Math.max(1, Math.round((count - 1) / Math.max(1, target - 1)));
  const ticks: number[] = [];
  for (let i = 0; i < count; i += step) ticks.push(i);
  const last = count - 1;
  if (ticks[ticks.length - 1] !== last) {
    if (last - ticks[ticks.length - 1] < step / 2 && ticks.length > 1) ticks.pop();
    ticks.push(last);
  }
  return ticks;
}

/** Month labels placed under their points, matching InteractiveChart's x scale. */
export default function AxisTicks({
  labels,
  target = 6,
  className = "",
}: {
  labels: string[];
  target?: number;
  className?: string;
}) {
  const last = labels.length - 1;
  return (
    <div
      className={`relative h-2.5 font-fx-mono text-[10px] leading-none text-fx-ink-3 ${className}`}
    >
      {tickIndices(labels.length, target).map((i) => {
        const pos = last > 0 ? (i / last) * 100 : 0;
        // Edge labels hug the edge instead of centring past it.
        const shift = i === 0 ? "0" : i === last ? "-100%" : "-50%";
        return (
          <span
            key={i}
            className="absolute top-0 whitespace-nowrap"
            style={{ left: `${pos}%`, transform: `translateX(${shift})` }}
          >
            {labels[i]}
          </span>
        );
      })}
    </div>
  );
}
