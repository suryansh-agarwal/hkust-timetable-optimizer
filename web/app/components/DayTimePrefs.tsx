"use client";

/**
 * The day-row preference controls, extracted from page.tsx.
 *
 * page.tsx had four near-identical checkbox-plus-time-select blocks and two
 * near-identical day-checkbox blocks, differing only in which state they read.
 * They live here as two components so the shadcn migration in the next task is
 * written once instead of four times.
 *
 * These are presentational: page.tsx still owns the state, because it feeds
 * buildPrefs() and the /optimize/ranked payload.
 */

export type DayPref = { enabled: boolean; time: string };

export function DayCheckboxGroup({
  idPrefix,
  days,
  selected,
  onChange,
}: Readonly<{
  idPrefix: string;
  days: readonly string[];
  selected: string[];
  onChange: (days: string[]) => void;
}>) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {days.map((d) => (
        <label key={d} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          <input
            type="checkbox"
            id={`${idPrefix}-${d}`}
            checked={selected.includes(d)}
            onChange={(e) => {
              if (e.target.checked) {
                onChange([...selected, d]);
              } else {
                onChange(selected.filter((x) => x !== d));
              }
            }}
          />
          {d}
        </label>
      ))}
    </div>
  );
}

export function DayTimeGroup({
  idPrefix,
  days,
  values,
  times,
  onChange,
}: Readonly<{
  idPrefix: string;
  days: readonly string[];
  values: Record<string, DayPref>;
  times: string[];
  onChange: (next: Record<string, DayPref>) => void;
}>) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {days.map((d) => (
        <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, width: 50 }}>
            <input
              type="checkbox"
              id={`${idPrefix}-${d}`}
              checked={values[d].enabled}
              onChange={(e) => onChange({ ...values, [d]: { ...values[d], enabled: e.target.checked } })}
            />
            {d}
          </label>
          <select
            value={values[d].time}
            disabled={!values[d].enabled}
            onChange={(e) => onChange({ ...values, [d]: { ...values[d], time: e.target.value } })}
            style={{ padding: 4, fontSize: 12, borderRadius: 4, opacity: values[d].enabled ? 1 : 0.5 }}
          >
            {times.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
