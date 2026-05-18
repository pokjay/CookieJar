"use client";

interface PersonSelectorProps {
  persons: string[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  multiple?: boolean;
  label?: string;
}

export default function PersonSelector({
  persons,
  value,
  onChange,
  multiple = false,
  label,
}: PersonSelectorProps) {
  if (multiple) {
    const selected = value as string[];
    return (
      <div className="flex items-center gap-3 flex-wrap">
        {label && <span className="text-sm font-medium text-cj-text-muted">{label}</span>}
        {persons.map((p) => (
          <label key={p} className="flex items-center gap-1.5 text-sm text-cj-text-3 cursor-pointer">
            <input
              data-testid={`person-checkbox-${p}`}
              type="checkbox"
              checked={selected.includes(p)}
              onChange={(e) => {
                if (e.target.checked) {
                  onChange([...selected, p]);
                } else {
                  onChange(selected.filter((s) => s !== p));
                }
              }}
              className="rounded bg-cj-hover border-cj-border-strong accent-cj-accent focus:ring-cj-accent"
            />
            {p}
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {label && <span className="text-sm font-medium text-cj-text-muted">{label}</span>}
      <select
        data-testid="person-selector"
        value={value as string}
        onChange={(e) => onChange(e.target.value)}
        className="bg-cj-elevated border border-cj-border-strong text-cj-text rounded-lg px-3 py-2 text-sm focus:ring-cj-accent focus:border-cj-accent"
      >
        <option value="">Household</option>
        {persons.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </div>
  );
}
