"use client";

export default function FilterSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-cj-text-faint">{label}</label>
      <select
        disabled={disabled}
        className="bg-cj-surface border border-cj-border-strong rounded-lg px-3 py-2 text-sm text-cj-text-2 focus:outline-none focus:border-cj-border-strong disabled:opacity-40"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
