"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
    /* A grid, not flex-wrap: the shadcn checkbox and its Label are wider than
       the native input they replaced, so five days no longer fit on one
       flex row and Fr dropped to a second line. Five equal columns keep the
       row intact and line the days up with the column below. */
    <div className="grid grid-cols-5 gap-x-1 gap-y-2">
      {days.map((d) => {
        const id = `${idPrefix}-${d}`;
        return (
          <div key={d} className="flex items-center gap-1.5">
            <Checkbox
              id={id}
              checked={selected.includes(d)}
              onCheckedChange={(checked) =>
                onChange(checked ? [...selected, d] : selected.filter((x) => x !== d))
              }
            />
            <Label htmlFor={id} className="text-sm font-normal">{d}</Label>
          </div>
        );
      })}
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
    <div className="flex flex-col gap-2">
      {days.map((d) => {
        const id = `${idPrefix}-${d}`;
        return (
          <div key={d} className="flex items-center gap-2 text-sm">
            <div className="flex w-12 items-center gap-2">
              <Checkbox
                id={id}
                checked={values[d].enabled}
                onCheckedChange={(checked) =>
                  onChange({ ...values, [d]: { ...values[d], enabled: checked === true } })
                }
              />
              <Label htmlFor={id} className="text-sm font-normal">{d}</Label>
            </div>
            <Select
              value={values[d].time}
              disabled={!values[d].enabled}
              onValueChange={(v) => onChange({ ...values, [d]: { ...values[d], time: String(v) } })}
            >
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {times.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
