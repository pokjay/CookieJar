"use client";

interface YearSelectorProps {
  years: number[];
  value: number;
  onChange: (year: number) => void;
}

export default function YearSelector({ years, value, onChange }: YearSelectorProps) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-cj-text-muted">Year</label>
      <select
        data-testid="year-selector"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-cj-elevated border border-cj-border-strong text-cj-text rounded-lg px-3 py-2 text-sm focus:ring-cj-accent focus:border-cj-accent"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
