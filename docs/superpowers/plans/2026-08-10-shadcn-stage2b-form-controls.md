# shadcn Adoption — Stage 2b: Form Controls

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every native `<select>`, `<input>` and checkbox in the app with shadcn `Select`, `Input`, `Checkbox` and `Label`, and collapse the four duplicated day/time preference blocks into one component.

**Architecture:** Stage 2a migrated overlays, feedback and actions. This stage takes the form controls — the half of stage 2 where the accessibility win is largest, because the professor and section pickers are currently native selects holding long option lists with no search and no keyboard affordance beyond the browser default. The four near-identical day/time blocks are extracted into one component *before* migration, so the new markup is written once rather than four times.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui `base-nova` style over `@base-ui/react`, `next-themes`.

**Design spec:** `docs/superpowers/specs/2026-08-09-shadcn-redesign-design.md`

**Branch:** all tasks land on `feature/shadcn-stage2b`, cut from `master`. Create it before Task 1:

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer && git checkout -b feature/shadcn-stage2b
```

## Scope

The spec lists stage 2b as Select, Checkbox, Input, Label, Card, Badge, Separator, Tooltip. This plan takes **the form-control family only** — Select, Checkbox, Input, Label — and moves Card, Badge, Separator and Tooltip to stage 3.

That is a deliberate change to the spec's grouping, for two reasons. Card, Badge and Separator are surface components, and stage 3 *is* the layout-and-typography pass that restructures those exact surfaces and splits `page.tsx`; migrating them now means styling surfaces that stage 3 immediately restyles. Tooltip was in the spec to replace the `title` attributes, and half of the eight `title` attributes in the app sit on controls this stage rewrites — what survives is better assessed afterwards.

What this stage covers, counted from the current tree:

| | `page.tsx` | `CoursePicker.tsx` | `login/page.tsx` |
|---|---|---|---|
| `<select>` source sites | 10 | 3 | 0 |
| `<input>` source sites | 8 | 1 | 1 |
| lines | 1,220 | 513 | 196 |

Six of those `page.tsx` select/input sites sit inside `DAYS.map()` loops, so they render 20 selects and 30 checkboxes.

## Global Constraints

Every task's requirements implicitly include this section.

- **`shadcn add` is destructive to same-named tokens.** Stage 1 established this: `init` silently replaced `--accent`, `--border` and `--font-sans`. After any CLI run, diff `web/app/globals.css` and revert unintended token changes before doing anything else.
- Migrated markup uses **Tailwind classNames**, not inline styles. Do not mix `style={{}}` and `className` on the same element.
- Never write a hex or named colour, in either form. Use tokens: `bg-primary`, `text-muted-foreground`, `border-border`.
- **Legacy aliases may only be deleted once every consumer is gone.** An undefined CSS variable fails silently — the colour vanishes and nothing errors.
- **Never add a colour rule outside a cascade layer.** Stage 2a shipped a Critical because an unlayered `button { color: var(--foreground) }` in `globals.css` outranked Tailwind's `@layer utilities` and blacked out every filled-navy button in the light theme. Unlayered declarations beat layered ones regardless of specificity. If a global element rule is genuinely needed, it goes in `@layer base`.
- Do not touch `web/app/components/TimetableGrid.tsx`. It is stage 4.
- Do not migrate Card, Badge, Separator or Tooltip. Those are stage 3.
- Do not change any application state shape, and do not change the payload sent to `/optimize/ranked`. This stage swaps controls, not behaviour. `hardFreeDays`, `hardNoAfter`, `sectionLocks`, `locks` and friends keep their exact current types and values.
- `web/proxy.ts` is the auth gate. If a task moves it aside for a preview route, it must be restored in the same task.
- Python backend untouched: `api/` stays at 74 passing tests.
- Lint baseline: `npx eslint .` reports two PRE-EXISTING problems — `prefer-const` in `app/auth/callback/route.ts` and `@next/next/no-img-element` in `app/login/page.tsx`. Neither is in scope. The bar is **no new problems**.

## The three Base UI Select laws

These were established by reading the installed `@base-ui/react` 1.7.0 source, not the docs, because each one fails silently and none of them would be caught by `tsc`, `eslint`, `vitest` or `next build`. Every task that touches a Select obeys them.

### Law 1 — `value=""` means "nothing is selected"

`node_modules/@base-ui/react/select/root/SelectRoot.js:185`:

```js
const hasSelectedValue = multiple ? ... : value != null && serializedValue !== '';
```

An empty string is not a value to Base UI; it is the absence of one. The app uses `""` as a real, user-selectable option in five places — `Any`, `Any professor`, `(select)`, and the single-instructor case where `value=""` carries the professor's *name* as its label. Ported naively, those items become unselectable and the trigger shows the placeholder instead of the label.

**The rule:** carry a sentinel through the control and map it back to `""` at the state boundary. Do not change the state shape — `""` is what the API payload expects.

```tsx
// Base UI treats value="" as "nothing selected" (SelectRoot.js:185), which
// would make the "Any" item unselectable. Carry a sentinel through the
// control and map back to "" at the state boundary, so app state and the
// /optimize/ranked payload keep the empty string they already use.
const ANY = "__any";
```

```tsx
<Select
  value={pins.lecture || ANY}
  onValueChange={(v) => setPin(code, "lecture", v === ANY ? "" : String(v))}
>
```

### Law 2 — a Select whose label differs from its value needs an `items` prop

The popup is unmounted until first open, so the trigger cannot read labels from rendered `SelectItem` children. `SelectValue` resolves the label through `resolveSelectedLabel(value, items, itemToStringLabel)` in `node_modules/@base-ui/react/internals/resolveValueLabel.js:69`, and with no `items` prop it falls through to `stringifyAsLabel(value)` — which returns `String(value)`, the raw value.

So a select whose option text equals its value is safe without `items`, and one whose text differs will display the raw value until the user opens it. In this app:

| Control | Value | Label | `items` needed? |
|---|---|---|---|
| Time cutoffs (`15:00`) | `"15:00"` | `15:00` | no |
| Gap / early-late penalty | `"Low"` | `Low` | no |
| Gap shape | `"no_preference"` | `No preference` | **yes** |
| Term | `"2610"` | `2026 Fall` | **yes** |
| Compare A / B | pin id | pin name | **yes** |
| Lecture / Tutorial / Lab | `"L1"` | `L1 · Mo 09:00` | **yes** |
| Professor | `"prof:NAME"` | `NAME` | **yes** |

`items` accepts a flat array of `{ value, label }`, a record map `{ value: label }`, or — for grouped selects — an array of `{ items: [{ value, label }, …] }`.

### Law 3 — `<optgroup>` becomes `SelectGroup` + `SelectLabel`

Verified present on the primitive: `Select.Group` and `Select.GroupLabel` exist, and the generated `select.tsx` exports `SelectGroup` and `SelectLabel` for them. Grouped selects also pass their `items` in grouped shape (Law 2).

## The Checkbox label question

Base UI's `Checkbox` renders "a `<span>` element and a hidden `<input>` beside" (`CheckboxRoot.js:41`), and that hidden input is `aria-hidden: true` (`:203`). The app currently nests every checkbox inside a `<label>`, which is what makes clicking the day letters `Mo Tu We Th Fr` toggle them — 30 rendered checkboxes rely on this.

Whether that click-to-toggle survives when the labelable element is Base UI's hidden `aria-hidden` input is **not settled by reading the source**, so this plan does not assert an answer. Task 3 uses shadcn's documented pattern — `<Checkbox id={id} />` beside `<Label htmlFor={id}>` — and then **verifies click-to-toggle in a real browser before the task is allowed to close**. Task 3's Step 6 states the fallback to use if it does not work.

Base UI's Checkbox API is `checked` / `onCheckedChange(boolean)`, not `onChange(event)`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `web/components/ui/{select,checkbox,input,label}.tsx` | generated primitives | created, Task 1 |
| `web/app/components/DayTimePrefs.tsx` | the day-row preference controls: a checkbox-per-day group and a checkbox+time-select-per-day group. Owns no state; takes values and setters. | created, Task 2 |
| `web/app/(app)/page.tsx` | page composition | four duplicated blocks replaced by two components (Task 2); standalone selects migrated (Task 4); pin-rename input migrated (Task 6) |
| `web/app/components/CoursePicker.tsx` | course search and per-course locks | section/professor selects migrated (Task 5); search input migrated (Task 6) |
| `web/app/login/page.tsx` | sign-in | email input migrated (Task 6) |
| `web/app/globals.css` | tokens | dead rules and orphaned aliases removed, Task 7 |

`DayTimePrefs.tsx` sits in `app/components/` beside `CoursePicker.tsx` and `TimetableGrid.tsx`, following the existing convention. It is deliberately a presentational component with no state of its own: `page.tsx` keeps owning `hardFreeDays`, `hardNoAfter`, `hardNoBefore`, `softFreeDays`, `softNoAfter` and `softNoBefore`, because those feed `buildPrefs()` and the API payload.

---

### Task 1: Install the form-control components

**Files:**
- Create: `web/components/ui/select.tsx`, `web/components/ui/checkbox.tsx`, `web/components/ui/input.tsx`, `web/components/ui/label.tsx`
- Verify unchanged: `web/app/globals.css`

**Interfaces:**
- Consumes: the shadcn setup from stage 1 (`components.json`, `cn()` in `@/lib/utils`).
- Produces: `Select`, `SelectGroup`, `SelectValue`, `SelectTrigger`, `SelectContent`, `SelectLabel`, `SelectItem`, `SelectSeparator`, `SelectScrollUpButton`, `SelectScrollDownButton`; `Checkbox`; `Input`; `Label`. Tasks 2–6 import these from `@/components/ui/*`.

- [ ] **Step 1: Record the current stylesheet so the CLI cannot change it unnoticed**

```bash
cd web && md5 -q app/globals.css
```

Note the value. Step 3 compares against it.

- [ ] **Step 2: Add the components**

```bash
cd web && npx shadcn@latest add select checkbox input label --yes --overwrite
```

None of these pulls a new dependency — `@base-ui/react` and `lucide-react` are already installed.

- [ ] **Step 3: Check whether the CLI touched the stylesheet**

```bash
cd web && md5 -q app/globals.css && git diff --stat app/globals.css
```

If the hash differs from Step 1, inspect the diff. Revert any change to `:root`, `.dark` or `@theme inline` with `git checkout -- app/globals.css`, then re-verify the hash matches. Do not accept a token change on the assumption it is harmless.

- [ ] **Step 4: Confirm the exports the later tasks depend on**

```bash
cd web && grep -h "^export" components/ui/{select,checkbox,input,label}.tsx
```

Expected: `select.tsx` exports the ten names listed under Interfaces; `checkbox.tsx` exports `Checkbox`; `input.tsx` exports `Input`; `label.tsx` exports `Label`. If any name is missing, stop and report — the later tasks are written against these names.

- [ ] **Step 5: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: all clean, 17 vitest tests. Nothing visible changes — nothing consumes these yet.

- [ ] **Step 6: Commit**

```bash
git add web/components/ui web/package.json web/package-lock.json
git commit -m "chore(web): add select, checkbox, input and label

Generated source only; nothing consumes them until the next task."
```

---

### Task 2: Extract the duplicated day-preference blocks

**Files:**
- Create: `web/app/components/DayTimePrefs.tsx`
- Modify: `web/app/(app)/page.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 — this task deliberately uses no shadcn component.
- Produces:

```tsx
// page.tsx already declares this shape as `SoftDayPref` and annotates all four
// cutoff states with it. It moves here under a name that is not misleading -
// two of the four states it types are hard constraints - and page.tsx imports
// it, so there is exactly one name for one shape.
export type DayPref = { enabled: boolean; time: string };

export function DayCheckboxGroup(props: Readonly<{
  idPrefix: string;
  days: readonly string[];
  selected: string[];
  onChange: (days: string[]) => void;
}>): React.JSX.Element;

export function DayTimeGroup(props: Readonly<{
  idPrefix: string;
  days: readonly string[];
  values: Record<string, DayPref>;
  times: string[];
  onChange: (next: Record<string, DayPref>) => void;
}>): React.JSX.Element;
```

Task 3 migrates the insides of these two components and does not change these signatures.

`page.tsx` currently contains six blocks built from `DAYS.map()`: two multi-select day rows ("Must be free", "Prefer free") and four checkbox-plus-time-select rows ("No classes after" and "No classes before", once under hard and once under soft). The four time blocks are near-verbatim copies of each other, differing only in which state they read and which time list they offer. Migrating them in place would mean writing the new Select and Checkbox markup four times, which is exactly the duplication a reviewer is asked to reject.

**This task changes no markup.** It moves existing JSX into two components, unchanged, inline styles and all. The rendered output must be identical before and after — that is what makes it reviewable.

- [ ] **Step 1: Create the component file**

```tsx
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
```

The `id` attributes are new — nothing in the current markup carries one. They are added now, while the markup is otherwise unchanged, because Task 3 needs them for `Label htmlFor` and adding them here keeps that task's diff to the control swap.

- [ ] **Step 2: Import it in `page.tsx` and retire the duplicate type**

```tsx
import { DayCheckboxGroup, DayTimeGroup, type DayPref } from "../components/DayTimePrefs";
```

`page.tsx` declares `type SoftDayPref = { enabled: boolean; time: string }` and uses it in nine places, all four cutoff states among them. Delete that declaration and replace every `SoftDayPref` with `DayPref`:

```bash
cd web && grep -c "SoftDayPref" "app/(app)/page.tsx"
```

Expected before: `9`. After the swap, `0`. Two names for one shape is how a codebase drifts, and the component's props already need the type exported.

- [ ] **Step 3: Replace the six blocks**

Each replacement keeps the surrounding heading `<div>` and its wrapper exactly as they are — only the inner `DAYS.map()` construct is replaced.

Hard "Must be free":

```tsx
                <DayCheckboxGroup
                  idPrefix="hard-free"
                  days={DAYS}
                  selected={hardFreeDays}
                  onChange={setHardFreeDays}
                />
```

Hard "No classes after":

```tsx
                <DayTimeGroup
                  idPrefix="hard-after"
                  days={DAYS}
                  values={hardNoAfter}
                  times={NO_AFTER_TIMES}
                  onChange={setHardNoAfter}
                />
```

Hard "No classes before": same with `idPrefix="hard-before"`, `values={hardNoBefore}`, `times={NO_BEFORE_TIMES}`, `onChange={setHardNoBefore}`.

Soft "Prefer free": `DayCheckboxGroup` with `idPrefix="soft-free"`, `selected={softFreeDays}`, `onChange={setSoftFreeDays}`.

Soft "No classes after": `DayTimeGroup` with `idPrefix="soft-after"`, `values={softNoAfter}`, `times={NO_AFTER_TIMES}`, `onChange={setSoftNoAfter}`.

Soft "No classes before": `DayTimeGroup` with `idPrefix="soft-before"`, `values={softNoBefore}`, `times={NO_BEFORE_TIMES}`, `onChange={setSoftNoBefore}`.

Read the actual state variable names out of `page.tsx` before writing these — if a setter is named differently from the guess above, use the real name and say so in your report.

- [ ] **Step 4: Confirm the extraction removed the duplication**

```bash
cd web && grep -c "DAYS.map" "app/(app)/page.tsx"
```

Expected: `0`. If any survive, a block was missed.

- [ ] **Step 5: Verify**

```bash
cd web && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 6: Verify the rendered output is unchanged**

This task claims to be a pure move, so prove it. Start the dev server in the **background** (`next dev` never exits; a foreground run will hang), open the preferences panel, and confirm by eye that both preference columns look exactly as they did: five day checkboxes on each "free" row, five checkbox-plus-dropdown rows on each cutoff row, dropdowns disabled and half-opacity until their day is checked.

Then check one interaction end to end: tick a hard cutoff day, change its time, and confirm the state still reaches the optimiser — run an optimize and confirm the request succeeds.

- [ ] **Step 7: Commit**

```bash
git add web/app/components/DayTimePrefs.tsx "web/app/(app)/page.tsx"
git commit -m "refactor(web): extract the duplicated day-preference blocks

page.tsx carried four near-identical checkbox-plus-time-select blocks and
two near-identical day-checkbox blocks, differing only in which state they
read. They become two presentational components so the shadcn migration is
written once rather than four times.

Pure move: the markup is unchanged apart from new id attributes, which the
migration needs for Label htmlFor."
```

---

### Task 3: Migrate the day-preference controls

**Files:**
- Modify: `web/app/components/DayTimePrefs.tsx`

**Interfaces:**
- Consumes: `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `Checkbox`, `Label` from Task 1; the two component signatures from Task 2.
- Produces: nothing new. The exported signatures do not change, so `page.tsx` is untouched.

This task migrates 30 rendered checkboxes and 20 rendered selects by editing two components. The time selects need **no `items` prop** — their value equals their label (Law 2).

- [ ] **Step 1: Import the primitives**

```tsx
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

- [ ] **Step 2: Migrate `DayCheckboxGroup`'s body**

```tsx
    <div className="flex flex-wrap gap-3">
      {days.map((d) => {
        const id = `${idPrefix}-${d}`;
        return (
          <div key={d} className="flex items-center gap-2">
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
```

`onCheckedChange` gives a boolean, not an event — Base UI's Checkbox is not a native input.

- [ ] **Step 3: Migrate `DayTimeGroup`'s body**

```tsx
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
```

The old `opacity: values[d].enabled ? 1 : 0.5` goes: `SelectTrigger` carries `disabled:opacity-50` already, so reproducing it by hand would double-dim.

`checked === true` rather than a bare `checked`: Base UI's callback type admits an indeterminate state, and the state field is a plain `boolean`.

- [ ] **Step 4: Confirm no native control survives in this file**

```bash
cd web && grep -n "<select\|<input\|style={{" app/components/DayTimePrefs.tsx || echo "  fully migrated"
```

Expected: no output.

- [ ] **Step 5: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 6: Verify click-to-toggle in a browser — this gate is not optional**

The old markup nested each `<input type="checkbox">` inside its `<label>`, so clicking the day letter toggled it. Base UI's Checkbox renders a `<span>` plus a **hidden, `aria-hidden`** input (`CheckboxRoot.js:41,203`), and whether a `<Label htmlFor>` still drives it is not answerable from the source. Test it:

Start the dev server in the **background**, open the preferences panel, and click the letter `Mo` — the text, not the box. The checkbox must toggle.

**If it does not toggle**, replace the `Label` in both components with a click-forwarding wrapper that shares the checkbox's handler, and say in your report that you did:

```tsx
<Label
  htmlFor={id}
  className="cursor-pointer text-sm font-normal"
  onClick={(e) => { e.preventDefault(); /* call the same onCheckedChange body */ }}
>
```

Also confirm, in both themes: the box shows a check when ticked, the time dropdown is disabled and dimmed until its day is ticked, the dropdown opens on click and on `Enter`, arrow keys move between options, `Escape` closes it, and the trigger shows the selected time — **before** the popup has ever been opened, which is the Law 2 case.

- [ ] **Step 7: Confirm the payload did not change**

Tick a hard cutoff, set a time, run an optimize, and confirm the request succeeds and the results reflect the constraint. The state shape must be untouched.

- [ ] **Step 8: Commit**

```bash
git add web/app/components/DayTimePrefs.tsx
git commit -m "feat(web): migrate the day-preference controls to shadcn

Thirty rendered checkboxes and twenty rendered selects, from two component
bodies. The time selects need no items prop because their value equals
their label; Base UI only falls back to stringifying the value when the two
differ.

Drops the hand-rolled disabled opacity - SelectTrigger already carries
disabled:opacity-50, and keeping both double-dimmed it."
```

---

### Task 4: Migrate the standalone selects in `page.tsx`

**Files:**
- Modify: `web/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `Select` and friends, `Label` from Task 1.
- Produces: nothing downstream.

Six selects: the term picker, three weight presets, and the two compare pickers. Three of them need an `items` prop (Law 2) and the compare pair also hits Law 1.

- [ ] **Step 1: Import**

```tsx
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

- [ ] **Step 2: Migrate the term picker**

Its label is `2026 Fall` while its value is `2610`, so it needs `items` or the trigger shows `2610` until first open. `TERM_OPTIONS` is already `{ value, label }` shaped, so it can be passed directly.

```tsx
          <div className="mb-3">
            <Label htmlFor="term-select" className="mb-2 block text-sm">Term</Label>
            <Select
              value={term}
              onValueChange={(v) => handleTermChange(String(v))}
              items={TERM_OPTIONS as unknown as { value: string; label: string }[]}
            >
              <SelectTrigger id="term-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TERM_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
```

The cast is needed because `TERM_OPTIONS` is `as const`, so its `value` and `label` are literal types. If `tsc` accepts it without the cast, drop the cast and say so.

- [ ] **Step 3: Migrate the two weight presets**

Value equals label here, so **no `items`**.

```tsx
              <div className="flex items-center gap-2 text-sm text-foreground">
                <span className="w-36">Gap penalty:</span>
                <Select
                  value={gapWeightPreset}
                  onValueChange={(v) => setGapWeightPreset(v as WeightPreset)}
                >
                  <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Med">Med</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
```

Repeat for "Early/late penalty:" with `earlyLateWeightPreset` / `setEarlyLateWeightPreset`.

- [ ] **Step 4: Migrate the gap-shape select**

Label and value differ (`no_preference` → `No preference`), so it **needs `items`**.

```tsx
              <div className="flex items-center gap-2 text-sm text-foreground">
                <span className="w-36">Gap shape:</span>
                <Select
                  value={gapShape}
                  onValueChange={(v) => setGapShape(v as GapShape)}
                  items={[
                    { value: "no_preference", label: "No preference" },
                    { value: "consolidated", label: "Prefer one long gap" },
                    { value: "fragmented", label: "Prefer several short gaps" },
                  ]}
                >
                  <SelectTrigger size="sm" className="w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no_preference">No preference</SelectItem>
                    <SelectItem value="consolidated">Prefer one long gap</SelectItem>
                    <SelectItem value="fragmented">Prefer several short gaps</SelectItem>
                  </SelectContent>
                </Select>
              </div>
```

- [ ] **Step 5: Migrate the `preferOneFreeDay` checkbox**

```tsx
            <div className="mt-3 flex flex-col gap-2 text-sm text-foreground">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="prefer-one-free-day"
                  checked={preferOneFreeDay}
                  onCheckedChange={(checked) => setPreferOneFreeDay(checked === true)}
                />
                <Label htmlFor="prefer-one-free-day" className="font-normal">
                  Prefer at least one free weekday
                </Label>
              </div>
            </div>
```

Add `Checkbox` to the imports from Step 1.

- [ ] **Step 6: Migrate the two compare selects**

These hit both laws: the placeholder option is `<option value="">(select)</option>` (Law 1) and the label is the pin's name while the value is its id (Law 2).

Declare the sentinel once, near the top of the file beside the other module constants:

```tsx
// Base UI treats value="" as "nothing selected" (SelectRoot.js:185), so the
// "(select)" item would be unselectable and the trigger would fall back to the
// placeholder. Carry a sentinel through the control and map it back to "" at
// the state boundary, because compareA/compareB feed the compare view as "".
const NO_SELECTION = "__none";
```

Then, for Option A:

```tsx
                  <Label htmlFor="compare-a" className="text-sm font-semibold">Option A:</Label>
                  <Select
                    value={compareA || NO_SELECTION}
                    onValueChange={(v) => setCompareA(v === NO_SELECTION ? "" : String(v))}
                    items={[
                      { value: NO_SELECTION, label: "(select)" },
                      ...pinned.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  >
                    <SelectTrigger id="compare-a" size="sm" className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SELECTION}>(select)</SelectItem>
                      {pinned.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
```

Repeat for Option B with `compare-b`, `compareB`, `setCompareB`.

- [ ] **Step 7: Confirm no `<select>` survives in `page.tsx`**

```bash
cd web && grep -n "<select\|<option" "app/(app)/page.tsx" || echo "  no native selects remain"
```

Expected: no output.

- [ ] **Step 8: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 9: Verify the Law 2 cases in a browser**

Dev server in the **background**. Without opening any dropdown, confirm each trigger shows its *label*, not its raw value:

- Term reads `2026 Fall`, not `2610`
- Gap shape reads `No preference`, not `no_preference`
- With two options pinned, Option A reads `(select)`, and after choosing one it reads the pin's name, not its id

Then pick a pinned option in A and B and confirm the compare view still renders both — that is the round trip through the `NO_SELECTION` sentinel.

- [ ] **Step 10: Commit**

```bash
git add "web/app/(app)/page.tsx"
git commit -m "feat(web): migrate the standalone selects to shadcn Select

Term, the three weight presets, both compare pickers and the free-weekday
checkbox.

Three of them pass an items prop: Base UI resolves the trigger's label from
that prop, not from the unmounted popup's children, so a select whose label
differs from its value would otherwise display the raw value until first
opened. The compare pair also carries a sentinel, because Base UI reads an
empty string as no-selection and the app uses \"\" for \"(select)\"."
```

---

### Task 5: Migrate CoursePicker's section and professor selects

**Files:**
- Modify: `web/app/components/CoursePicker.tsx`

**Interfaces:**
- Consumes: `Select` and friends, `Label` from Task 1.
- Produces: nothing downstream.

The hardest task in the stage. Three selects, and between them they hit every one of the three laws plus a value-prefix protocol:

- The **Lecture** select mixes two option groups in one control — `<optgroup label="Professor">` with values `prof:NAME`, and `<optgroup label="Lecture">` with values like `L1`. Picking a `prof:` value sets an instructor lock and clears the lecture pin; picking a section value does the reverse.
- The **Tutorial** and **Lab** selects are disabled when the lecture determines them (`auto`), and in that state deliberately omit the "Any" option.
- The **professor-only fallback** select renders when the section fetch failed. Its `onlyOne` branch renders a single option whose value is `""` but whose label is the instructor's name — the worst Law 1 case in the app.

Read `lib/sectionOptions.ts` before starting: `optionsFor`, `matchingAppliesTo` and `reconcilePins` define the semantics this control exposes, and none of them changes.

- [ ] **Step 1: Import and declare the sentinel**

```tsx
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

Beside `samePins` and `summarise` at module scope:

```tsx
// Base UI treats value="" as "nothing selected" (SelectRoot.js:185), which
// would make "Any" unselectable and show the placeholder in its place. Carry a
// sentinel through the control and map it back to "" at the state boundary:
// "" is what setPin, setLock and the /optimize/ranked payload all expect.
const ANY = "__any";
```

- [ ] **Step 2: Migrate the professor-only fallback select**

```tsx
                      return instructors.length > 0 ? (
                        <Select
                          value={locks[code] || ANY}
                          disabled={onlyOne}
                          onValueChange={(v) => setLock(code, v === ANY ? "" : String(v))}
                          items={
                            onlyOne
                              ? [{ value: ANY, label: instructors[0] }]
                              : [
                                  { value: ANY, label: "Any professor" },
                                  ...instructors.map((n) => ({ value: n, label: n })),
                                ]
                          }
                        >
                          <SelectTrigger
                            size="sm"
                            className="max-w-56"
                            aria-label={`Professor for ${code}`}
                            title={onlyOne ? "Only one instructor teaches this course" : "Only use sections taught by this professor"}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {onlyOne ? (
                              <SelectItem value={ANY}>{instructors[0]}</SelectItem>
                            ) : (
                              <>
                                <SelectItem value={ANY}>Any professor</SelectItem>
                                {instructors.map((name) => (
                                  <SelectItem key={name} value={name}>{name}</SelectItem>
                                ))}
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      ) : null;
```

The `onlyOne` branch is the reason `items` is mandatory here: the value is the sentinel and the label is the instructor's name, so with no `items` the trigger would render `__any`.

- [ ] **Step 3: Migrate the Lecture select**

The grouped `items` shape is an array of `{ items: [...] }`, per Law 3. Build it from the same two sources the options come from, so the two cannot drift:

```tsx
                    const profItems = instructors.length > 1
                      ? [{ items: instructors.map((n) => ({ value: `prof:${n}`, label: n })) }]
                      : [];
                    const lecItems = lectures.length > 0
                      ? [{ items: lectures.map((s) => ({ value: s.section, label: `${s.section} · ${summarise(s)}` })) }]
                      : [];

                    rows.push(
                      <div key="lec" className="flex flex-col gap-1">
                        <Label htmlFor={`lec-${code}`} className="text-xs font-normal text-muted-foreground">
                          Lecture
                        </Label>
                        <Select
                          value={pins.lecture || (locks[code] ? `prof:${locks[code]}` : ANY)}
                          onValueChange={(value) => {
                            const v = String(value);
                            if (v.startsWith("prof:")) {
                              setLock(code, v.slice(5));
                              setPin(code, "lecture", "");
                            } else {
                              setLock(code, "");
                              setPin(code, "lecture", v === ANY ? "" : v);
                            }
                          }}
                          items={[{ items: [{ value: ANY, label: "Any" }] }, ...profItems, ...lecItems]}
                        >
                          <SelectTrigger id={`lec-${code}`} size="sm" className="max-w-60">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ANY}>Any</SelectItem>
                            {/* Same threshold the prune effect above applies. A
                                course with one instructor has nothing to choose,
                                and offering the name anyway made the control
                                snap back to "Any" the moment it was picked. */}
                            {instructors.length > 1 && (
                              <SelectGroup>
                                <SelectLabel>Professor</SelectLabel>
                                {instructors.map((n) => (
                                  <SelectItem key={n} value={`prof:${n}`}>{n}</SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            {lectures.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Lecture</SelectLabel>
                                {lectures.map((s) => (
                                  <SelectItem key={s.section} value={s.section}>
                                    {s.section} · {summarise(s)}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    );
```

The `<label>` becomes a `<div>` wrapper with a `Label` inside, because the old markup relied on wrapping a native select — which Base UI's trigger is not.

- [ ] **Step 4: Migrate the Tutorial and Lab selects**

```tsx
                    rows.push(
                      <div key={kind} className="flex flex-col gap-1">
                        <Label htmlFor={`${key}-${code}`} className="text-xs font-normal text-muted-foreground">
                          {kind === "TUT" ? "Tutorial" : "Lab"}
                        </Label>
                        <Select
                          value={pins[key] || ANY}
                          disabled={auto}
                          onValueChange={(v) => setPin(code, key, v === ANY ? "" : String(v))}
                          items={[
                            ...(auto ? [] : [{ value: ANY, label: "Any" }]),
                            ...options.map((s) => ({ value: s.section, label: `${s.section} · ${summarise(s)}` })),
                          ]}
                        >
                          <SelectTrigger
                            id={`${key}-${code}`}
                            size="sm"
                            className="max-w-60"
                            title={auto ? "Determined by the lecture you picked" : undefined}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {!auto && <SelectItem value={ANY}>Any</SelectItem>}
                            {options.map((s) => (
                              <SelectItem key={s.section} value={s.section}>
                                {s.section} · {summarise(s)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
```

`rows` is typed `ReactNode[]`, so pushing a `<div>` instead of a `<label>` needs no type change.

- [ ] **Step 5: Confirm no native select survives**

```bash
cd web && grep -n "<select\|<option\|<optgroup" app/components/CoursePicker.tsx || echo "  no native selects remain"
```

Expected: no output. (The search `<input>` is Task 6 and will still be there — this grep does not cover it.)

- [ ] **Step 6: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

`npx vitest run` covers `lib/sectionOptions.test.ts`, which is the logic behind these controls. It must stay at 17 passing — this task changes presentation only.

- [ ] **Step 7: Verify the section-lock behaviour end to end in a browser**

This is the feature the controls exist for, and the one place where a silent regression would be invisible to every automated check. Dev server in the **background**. Add `MATH 1003` and check, in both themes:

1. The Lecture trigger reads `Any` before the dropdown has ever been opened — not `__any`.
2. Opening it shows the `Professor` and `Lecture` group headings.
3. Picking a lecture section narrows the Tutorial options to that lecture's group, and the Tutorial trigger shows `L1 · Mo 09:00`-style text, not a bare section code.
4. Switching to a different lecture clears a tutorial pin that no longer belongs to it.
5. Picking a professor from the `Professor` group clears any lecture pin, and picking a lecture clears the professor lock.
6. Where the tutorial is determined by the lecture, its select is disabled and offers no `Any`.
7. Running an optimize with a lecture pinned returns schedules that all use that section.

Report what you observed for each numbered item. If any behaves differently from the pre-migration control, stop and report rather than adjusting the semantics — `lib/sectionOptions.ts` is the contract and this task does not change it.

- [ ] **Step 8: Commit**

```bash
git add web/app/components/CoursePicker.tsx
git commit -m "feat(web): migrate the section and professor selects to shadcn

The hardest controls in the app: optgroups become SelectGroup/SelectLabel,
the prof: value protocol and the auto-determined disabled state are
preserved, and every \"Any\" carries a sentinel because Base UI reads an
empty string as no-selection.

All three pass items, since their labels differ from their values and Base
UI resolves the trigger's label from that prop rather than from the
unmounted popup."
```

---

### Task 6: Migrate the three text inputs

**Files:**
- Modify: `web/app/components/CoursePicker.tsx`, `web/app/(app)/page.tsx`, `web/app/login/page.tsx`

**Interfaces:**
- Consumes: `Input` from Task 1.
- Produces: nothing downstream.

Three inputs, each with a different reason for its current styling.

- [ ] **Step 1: Migrate the course search input**

The input sits inside a bordered row with a `🔎` emoji, and is deliberately border-less so the wrapper supplies the frame. Keep that arrangement — replacing the wrapper is stage 3 — but swap the input and the emoji.

```tsx
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Type a course code or title (e.g. "FINA 2303", "econometrics")'
            disabled={!indexReady}
            className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:border-0 focus-visible:ring-0"
          />
        </div>
```

Add `Search` to the existing `lucide-react` import. The wrapper previously switched its background on `indexReady`; keep that behaviour by driving the wrapper's class from the same flag rather than dropping it — read the current expression and carry it across.

- [ ] **Step 2: Migrate the pin-rename input**

This one is styled to look like plain text until edited, sitting inside a chip.

```tsx
                    <Input
                      type="text"
                      value={p.name}
                      onChange={(e) => renamePin(p.id, e.target.value)}
                      aria-label={`Rename ${p.name}`}
                      className="h-auto w-36 border-0 bg-transparent p-0 text-sm font-semibold shadow-none focus-visible:ring-0"
                    />
```

The `aria-label` is new: the input has no associated label and its only context is the surrounding chip, so it is unnamed to a screen reader today. Adding it is in scope because the element is being rewritten.

- [ ] **Step 3: Migrate the login email input**

This is a normal, full-width field, so it takes `Input`'s default styling rather than a stripped-down variant.

```tsx
            <Input
              type="email"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              placeholder="Email address"
              aria-label="Email address"
              required
              className="w-full"
            />
```

Note the stage 2a carry-over: this form's buttons are `h-8` while the old input was roughly 45px tall, so they did not line up. `Input`'s default height brings the two into the same scale — check that they now match, and say so in your report.

- [ ] **Step 4: Confirm no native text input survives**

```bash
cd web && grep -rn "<input" app components --include="*.tsx" | grep -v "components/ui/" || echo "  no native inputs remain in app code"
```

Expected: no output.

- [ ] **Step 5: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 6: Verify in a browser**

Dev server in the **background**, both themes. Confirm: typing in the course search still filters results and the field is disabled until the index loads; renaming a pin still updates the compare dropdowns; the login field accepts input, shows its placeholder, and its height now matches the buttons beneath it. Check the placeholder is legible in dark mode — `Input` sets its own placeholder colour and the app previously set one globally.

- [ ] **Step 7: Commit**

```bash
git add web/app/components/CoursePicker.tsx "web/app/(app)/page.tsx" web/app/login/page.tsx
git commit -m "feat(web): migrate the three text inputs to shadcn Input

Course search, pin rename and the login email field. The first two keep
their stripped-down look because their wrappers supply the frame; the login
field takes Input's default height, which also closes the stage-2a gap
where its buttons no longer lined up with it.

Adds an aria-label to the pin-rename input, which had no accessible name."
```

---

### Task 7: Clean up and verify the stage

**Files:**
- Modify: `web/app/globals.css`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Retire the global native-control rules**

`globals.css` carries rules that exist only to style native `<input>`, `<select>` and `<textarea>`:

```css
input:not([type="checkbox"]):not([type="radio"]),
select,
textarea { … }

input[type="checkbox"],
input[type="radio"] { accent-color: var(--primary); }

input:not([type="checkbox"]):not([type="radio"]):disabled,
select:disabled,
textarea:disabled { … }

input::placeholder { … }
```

Establish what is still live before removing anything:

```bash
cd web && grep -rn "<input\|<select\|<textarea" app components --include="*.tsx" | grep -v "components/ui/" || echo "  no native controls in app code"
```

If that comes back empty, these rules only reach the hidden inputs Base UI renders inside `Checkbox`, and they can go. Remove them, keeping the `input, select, textarea { font-family: inherit; color: var(--foreground); }` rule **only if** something still needs it — and if you keep it, note that it is unlayered and re-read the Global Constraints entry about cascade layers before deciding.

Report exactly which rules you removed and what evidence justified each.

- [ ] **Step 2: Remove aliases this stage orphaned**

Stage 2a left four legacy aliases with no consumers, and this stage may orphan more. Check each before removing it:

```bash
cd web && for t in pin-bg pin-border pin-text selected-bg overlay surface-2 surface-3 text-subtle text-faint border-subtle border-faint; do
  n=$(grep -rn "var(--$t)" app components --include="*.tsx" | wc -l | tr -d ' ')
  echo "  --$t: $n consumers"
done
```

Remove only the ones reporting `0`, from both `:root` and `.dark`. Leave `--overlay` regardless — stage 3 and 4 may use it, and it is documented as kept.

- [ ] **Step 3: Confirm every token still resolves**

```bash
cd web && comm -23 \
  <(grep -rhoE "var\(--[a-z0-9-]+" app components --include="*.tsx" | sed 's/var(//' | sort -u) \
  <(grep -oE "^[[:space:]]*--[a-z0-9-]+[[:space:]]*:" app/globals.css | sed 's/[[:space:]]//g; s/:$//' | sort -u)
```

Expected: no output. Any token printed here has lost its definition and its colour has silently vanished.

- [ ] **Step 4: Full gate**

```bash
cd api && .venv/bin/pytest tests/ -q
cd ../web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: 74 Python, 17 vitest, everything clean, no new eslint problems.

- [ ] **Step 5: Confirm no colour literals were introduced**

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer
git diff master...HEAD -- web/app web/components | grep "^+" | grep -oE '#[0-9a-fA-F]{3,8}\b|"white"|"crimson"' | sort -u || echo "  none"
```

- [ ] **Step 6: Confirm the cascade-layer trap was not re-sprung**

Stage 2a's Critical came from an unlayered element rule outranking Tailwind's utilities, and this stage edits the same region of `globals.css`. Prove it did not come back: build, then check that no unlayered rule sets `color` on an element selector.

```bash
cd web && grep -n "^[a-z]" app/globals.css
```

Read each match. Any bare element selector outside `@layer base` that sets a colour property is the same bug. Then confirm in the browser (Step 7) that a `variant="default"` button still has near-white text in the **light** theme — the dark theme cannot show this failure, because `--foreground` and `--primary-foreground` are the same value there.

- [ ] **Step 7: Whole-stage browser pass**

Dev server on port 3000 in the **background** — the API's CORS allowlist contains only that origin. Start the API from `api/` (also backgrounded) with `MINICATALOG_PATH="../web/public/course-index/{term}.json"`. Create `web/app/preview-tmp/page.tsx` rendering `Home` from `../(app)/page`, and `rm web/proxy.ts` so the route is reachable — deleting rather than renaming, so Step 8's `git checkout` restores it. Do not commit while it is missing.

Walk the whole flow in **both themes**, and report each:

1. Add two courses; pin a lecture on one; run an optimize; pin two results; compare them.
2. Every select trigger shows a label rather than a raw value, before its dropdown is first opened.
3. Every select opens on click and on `Enter`, moves on arrow keys, closes on `Escape`, and returns focus to its trigger.
4. Clicking a day letter toggles its checkbox.
5. Disabled selects — a cutoff whose day is unticked, an auto-determined tutorial — look disabled and do not open.
6. Console shows no errors, no warnings, no hydration mismatch.

- [ ] **Step 8: Clean up the preview scaffolding**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts 2>/dev/null; git status --short
```

Expected: clean apart from the repo's pre-existing untracked `kite-export.mp4`. **Verify `web/proxy.ts` exists** — a missing proxy silently disables authentication.

- [ ] **Step 9: Commit**

```bash
git add web/app/globals.css
git commit -m "chore(web): retire the global native-control styles

Every native input, select and textarea in app code is now a shadcn
component that carries its own styling, so the element rules that used to
theme them no longer reach anything. Removes the aliases this stage
orphaned; --overlay stays for later stages."
```

---

## Notes for the implementer

- **Read the three Base UI Select laws before writing any Select.** Each one fails silently and none is caught by `tsc`, `eslint`, `vitest` or `next build`. They were established by reading the installed 1.7.0 source, with file and line references — go and look if a call site seems to contradict one.
- **Never add a colour rule outside a cascade layer.** Stage 2a shipped a Critical this way. Unlayered declarations beat `@layer utilities` regardless of specificity, and the failure is invisible in dark mode.
- **Do not change state shapes or the API payload.** Sentinels exist so the state keeps its empty strings. If a migration seems to want a different state shape, that is a signal the sentinel was skipped.
- **`next dev` never exits.** Run it in the background in every task that needs a browser, or the task hangs until it times out.
- **`lib/sectionOptions.ts` is the contract for the section-lock semantics** and does not change in this stage. If a control's behaviour seems wrong, the control is wrong.
- Card, Badge, Separator and Tooltip are stage 3, along with splitting `page.tsx`. If a task tempts you into restructuring a surface, stop — that is the other plan.
