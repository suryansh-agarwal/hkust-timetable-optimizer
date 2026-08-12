# Stage 3a — Split `page.tsx` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break `web/app/(app)/page.tsx` — 1,148 lines, 26 state variables — into five components and two support modules, changing nothing a user can see and nothing the backend receives.

**Architecture:** `page.tsx` keeps every piece of state, because it feeds `runOptimize` and the Supabase persistence effects. The JSX moves out in five reviewable slices, each verified by rendering identically. The pure derivation helpers move to `web/lib/schedule.ts`, where the existing vitest config can finally test them — they have no coverage today and they compute the numbers on every result card.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, shadcn/ui over `@base-ui/react`, Vitest.

**Design spec:** `docs/superpowers/specs/2026-08-12-stage3-layout-and-responsive-design.md`

**Branch:** all tasks land on `feature/stage3a-split`, cut from `master`. Create it before Task 1:

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer && git checkout -b feature/stage3a-split
```

## Global Constraints

Every task's requirements implicitly include this section.

- **Nothing a user can see may change.** No restyling, no spacing tweaks, no "while I'm here" improvements. Inline styles move verbatim. Stage 3b is the redesign; this is the move that makes 3b reviewable.
- **The `/optimize/ranked` request body must stay byte-identical.** Task 1 captures a baseline; Tasks 2 and 7 diff against it.
- Never write a hex or named colour, and never add a colour rule outside a cascade layer. Stage 2a shipped a Critical when an unlayered rule outranked Tailwind's `@layer utilities`, invisible in one theme.
- Do not touch `web/app/components/TimetableGrid.tsx` (stage 4), `web/lib/sectionOptions.ts` (the section-lock contract), or `web/app/components/CoursePicker.tsx` and `DayTimePrefs.tsx` (already migrated and out of scope).
- **Do not fix `fontFamily: "system-ui"` at `page.tsx:549`.** It is a real bug — it overrides Geist app-wide — and it belongs to stage 3b, which ships it alone so the font change is bisectable.
- `web/proxy.ts` is the auth gate. Tasks that need a browser delete it temporarily and must restore it before committing.
- Python backend untouched: `api/` stays at 74 passing tests.
- Lint baseline: `npx eslint .` reports two PRE-EXISTING problems — `prefer-const` in `app/auth/callback/route.ts`, `@next/next/no-img-element` in `app/login/page.tsx`. Neither is in scope. The bar is **no new problems**.

## Reaching the app in a browser

`/` redirects to `/login`, so the page under test needs a preview route:

```bash
mkdir -p web/app/preview-tmp && cat > web/app/preview-tmp/page.tsx <<'EOF'
"use client";
import Home from "../(app)/page";
export default function PreviewPage() { return <Home />; }
EOF
rm web/proxy.ts
cd web && npx next dev --port 3000
```

`next dev` **must** run in the background — it never exits, and a foreground run hangs the task until it times out. Poll `http://localhost:3000/preview-tmp` with `curl` until it returns 200.

Course search and optimizing need the API, also backgrounded:

```bash
cd api && MINICATALOG_PATH="../web/public/course-index/{term}.json" .venv/bin/python -m uvicorn main:app --port 8000
```

Port 3000 is mandatory — the API's CORS allowlist contains only that origin.

Before committing:

```bash
rm -rf web/app/preview-tmp web/.next/types .playwright-mcp web/.playwright-mcp
git checkout -- web/proxy.ts
ls -la web/proxy.ts   # confirm it exists - a missing proxy disables auth
```

Removing `web/.next/types` matters: a stale `validator.ts` referencing the deleted preview route makes `tsc` fail with `TS2307`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `web/lib/schedule.ts` | turn an optimiser result into displayable facts | created, Task 1 |
| `web/lib/schedule.test.ts` | characterization tests for the above | created, Task 1 |
| `web/app/components/usePreferences.ts` | preference domain: constants, types, validation, the two state hooks | created, Task 2 |
| `web/app/components/Header.tsx` | title, identity, theme toggle, feedback, help trigger, Optimize | created, Task 3 |
| `web/app/components/PreferencesPanel.tsx` | hard box, soft box, weights, the error message | created, Task 4 |
| `web/app/components/ResultCard.tsx` | one option | created, Task 5 |
| `web/app/components/ResultsList.tsx` | the card grid, active selection, the selected schedule's grid | created, Task 5 |
| `web/app/components/CompareSection.tsx` | pinned list, A/B pickers, overlay grid | created, Task 6 |
| `web/app/(app)/page.tsx` | state ownership and composition only | shrinks across every task |

The two support modules exist because a split needs somewhere to put what more than one piece uses. `schedule.ts` goes in `web/lib/` rather than `web/app/components/` for a concrete reason: `vitest.config.ts` has `include: ["lib/**/*.test.ts"]`, so code there is testable and code in `app/components/` is not.

### Region map of the current `page.tsx`

Verified against `ec4c70d`. Line numbers shift as tasks land, so each task re-locates its region by the landmark quoted, not by number.

| Lines | Region | Task |
|---|---|---|
| 549 | root `<div>` opens (carries the `system-ui` bug — leave it) | — |
| 550–581 | header row | 3 |
| 582–818 | two-column body: left = Term + CoursePicker (583–614), right = Preferences (616–817) | 4 |
| 819–1107 | `<div ref={resultsRef} id="results">`, all inside `{result && (…)}` | 5, 6 |
| 820–967 | results header, card grid, selected schedule's `TimetableGrid` | 5 |
| 968–1106 | Compare section | 6 |
| 1108–end | help `<Dialog>` | — |

Compare renders inside `{result && (…)}`. That is intentional and stays: pins are session-only state with no persistence, so there can be no pins without a result in the same session.

---

### Task 1: Extract the schedule helpers, with tests

**Files:**
- Create: `web/lib/schedule.ts`, `web/lib/schedule.test.ts`
- Modify: `web/app/(app)/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces, all imported by later tasks from `@/lib/schedule`:

```ts
export type Meeting = { day: string; start_min: number; end_min: number; course_code: string; section: string };
export type Penalty = { type: string; day?: string; cutoff?: string; minutes?: number; shape?: string };
export type Bonus = { type: string; day?: string; count?: number; value?: number };
export type Pinned = {
  id: string; name: string; term: string; sourceIdx: number;
  score: number; breakdown: unknown; schedule: unknown[]; createdAt: number;
};

export function makePinId(): string;
export function minutesToTime(m: number): string;
export function flattenSchedule(schedule: unknown[]): Meeting[];
export function computeStatsFromMeetings(meetings: Meeting[]): {
  usedDaysCount: number; freeDaysCount: number; freeDays: string[];
  latestEndMin: number; latestEndDay: string | null;
  earliestStartMin: number | null; gapsMin: number;
};
export function formatDayList(days: string[]): string;
export function penaltyLabel(p: Penalty): string;
export function bonusLabel(b: Bonus): string;
```

`computeStatsFromMeetings` computes the numbers printed on every result card — free days, gaps, latest end — and has no test coverage at all. Moving it to `web/lib/` is what makes it testable, so this task writes the tests first and uses them to prove the move changed nothing.

- [ ] **Step 1: Capture the payload baseline before touching anything**

Later tasks must prove the request body is unchanged, so record it now, from the unmodified app.

Start the dev server and API per "Reaching the app in a browser", open the preview route, then in the browser console (or via Playwright `browser_evaluate`) run:

```js
(async () => {
  let captured = null;
  const orig = window.fetch;
  window.fetch = async (...a) => {
    if (String(a[0]).includes('/optimize/ranked') && a[1]?.body) captured = a[1].body;
    return orig(...a);
  };
  // add MATH 1003, tick hard "Must be free" Mo, set hard no-after Tu to 12:00,
  // set Gap shape to "Prefer one long gap", untick "Prefer at least one free weekday"
  // then click Optimize and wait
  return captured;
})()
```

Drive those five inputs first so the payload exercises every branch — free days, a cutoff map, a non-default gap shape, and a flipped boolean — then click Optimize and read `captured`.

Write the exact string to `/tmp/stage3a-payload-baseline.json`. Record in your report the inputs you used, verbatim, because Tasks 2 and 7 must reproduce them.

- [ ] **Step 2: Write the characterization tests**

These assert what the code does **today**. If one fails after the move, the move changed behaviour.

Create `web/lib/schedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  computeStatsFromMeetings,
  flattenSchedule,
  formatDayList,
  minutesToTime,
  penaltyLabel,
  bonusLabel,
  type Meeting,
} from "./schedule";

const mtg = (day: string, start_min: number, end_min: number, course_code = "COMP 1021", section = "L1"): Meeting =>
  ({ day, start_min, end_min, course_code, section });

describe("flattenSchedule", () => {
  it("flattens every meeting of every part, carrying the course code and section down", () => {
    const schedule = [
      { course_code: "MATH 1003", parts: [
        { section: "L1", meetings: [{ day: "Mo", start_min: 540, end_min: 620 }, { day: "We", start_min: 540, end_min: 620 }] },
        { section: "T1A", meetings: [{ day: "Fr", start_min: 660, end_min: 710 }] },
      ] },
    ];
    expect(flattenSchedule(schedule)).toEqual([
      { day: "Mo", start_min: 540, end_min: 620, course_code: "MATH 1003", section: "L1" },
      { day: "We", start_min: 540, end_min: 620, course_code: "MATH 1003", section: "L1" },
      { day: "Fr", start_min: 660, end_min: 710, course_code: "MATH 1003", section: "T1A" },
    ]);
  });

  it("returns an empty array for an empty schedule", () => {
    expect(flattenSchedule([])).toEqual([]);
  });
});

describe("computeStatsFromMeetings", () => {
  it("counts used and free weekdays", () => {
    const s = computeStatsFromMeetings([mtg("Mo", 540, 620), mtg("We", 540, 620)]);
    expect(s.usedDaysCount).toBe(2);
    expect(s.freeDaysCount).toBe(3);
    expect(s.freeDays).toEqual(["Tu", "Th", "Fr"]);
  });

  it("reports the latest end together with the day it falls on", () => {
    const s = computeStatsFromMeetings([mtg("Mo", 540, 620), mtg("Th", 1020, 1130)]);
    expect(s.latestEndMin).toBe(1130);
    expect(s.latestEndDay).toBe("Th");
  });

  it("sums gaps between consecutive classes on the same day, ignoring back-to-back", () => {
    const s = computeStatsFromMeetings([
      mtg("Mo", 540, 600),
      mtg("Mo", 660, 720), // 60 min gap
      mtg("Mo", 720, 780), // back to back, no gap
    ]);
    expect(s.gapsMin).toBe(60);
  });

  it("does not count time between classes on different days as a gap", () => {
    const s = computeStatsFromMeetings([mtg("Mo", 540, 600), mtg("Tu", 900, 960)]);
    expect(s.gapsMin).toBe(0);
  });

  it("sums gaps across several days", () => {
    const s = computeStatsFromMeetings([
      mtg("Mo", 540, 600), mtg("Mo", 630, 690), // 30
      mtg("We", 540, 600), mtg("We", 660, 720), // 60
    ]);
    expect(s.gapsMin).toBe(90);
  });

  it("orders a day's classes before measuring, so input order does not matter", () => {
    const late = computeStatsFromMeetings([mtg("Mo", 660, 720), mtg("Mo", 540, 600)]);
    expect(late.gapsMin).toBe(60);
  });

  it("reports the earliest start, and null when there are no meetings", () => {
    expect(computeStatsFromMeetings([mtg("Mo", 540, 600), mtg("Tu", 480, 540)]).earliestStartMin).toBe(480);
    expect(computeStatsFromMeetings([]).earliestStartMin).toBeNull();
  });

  it("returns five free days and no latest-end day for an empty schedule", () => {
    const s = computeStatsFromMeetings([]);
    expect(s.freeDaysCount).toBe(5);
    expect(s.latestEndDay).toBeNull();
    expect(s.latestEndMin).toBe(-1);
  });

  it("ignores meetings on days outside Mo-Fr", () => {
    const s = computeStatsFromMeetings([mtg("Sa", 540, 600)]);
    expect(s.usedDaysCount).toBe(0);
    expect(s.freeDaysCount).toBe(5);
  });
});

describe("minutesToTime", () => {
  it("zero-pads both halves", () => {
    expect(minutesToTime(540)).toBe("09:00");
    expect(minutesToTime(605)).toBe("10:05");
    expect(minutesToTime(0)).toBe("00:00");
  });
});

describe("formatDayList", () => {
  it("joins with a comma and space", () => {
    expect(formatDayList(["Mo", "We"])).toBe("Mo, We");
  });

  it("says (none) for an empty list", () => {
    expect(formatDayList([])).toBe("(none)");
  });
});

describe("penaltyLabel", () => {
  it("labels each type scoring.py can emit", () => {
    expect(penaltyLabel({ type: "soft_no_after", day: "Mo", cutoff: "17:00" })).toBe("After cutoff (Mo 17:00)");
    expect(penaltyLabel({ type: "soft_no_before", day: "Tu", cutoff: "09:00" })).toBe("Before cutoff (Tu 09:00)");
    expect(penaltyLabel({ type: "soft_free_day", day: "Fr" })).toBe("Fr not free");
  });

  it("falls through to the raw type name for anything unlabelled", () => {
    expect(penaltyLabel({ type: "some_future_penalty" })).toBe("some_future_penalty");
  });
});
```

Do **not** write assertions for `penaltyLabel`'s `gaps_minutes` branch or for `bonusLabel` yet — Step 3 has you read their real implementations first, and guessing their output then asserting the guess proves nothing.

- [ ] **Step 3: Read the real implementations and finish the tests**

Open `web/app/(app)/page.tsx` and read `penaltyLabel` (the `gaps_minutes` branch, which formats a shape) and `bonusLabel`. Add one `it(...)` per branch to `schedule.test.ts` asserting exactly what they return today. Quote their current source in your report so a reviewer can check your assertions against it.

- [ ] **Step 4: Run the tests to watch them fail**

```bash
cd web && npx vitest run lib/schedule.test.ts
```

Expected: FAIL — `Failed to resolve import "./schedule"`. The module does not exist yet.

- [ ] **Step 5: Create the module by moving the code**

Create `web/lib/schedule.ts`. Move these from `page.tsx` **verbatim**, changing only `function x` to `export function x` and `type X` to `export type X`:

`Meeting`, `Penalty`, `Bonus`, `Pinned` types; `makePinId`, `minutesToTime`, `flattenSchedule`, `computeStatsFromMeetings`, `formatDayList`, `penaltyLabel`, `bonusLabel`.

Head the file with:

```ts
/**
 * Turning an optimiser result into the facts a card displays.
 *
 * These live in lib/ rather than app/components/ so vitest can reach them -
 * vitest.config.ts includes lib/**\/*.test.ts and nothing under app/. They
 * compute the free-day, gap and latest-end numbers on every result card and
 * had no coverage before stage 3a.
 */
```

Leave `timeToMinutes` and `validateTimeConstraints` in `page.tsx` — Task 2 owns those.

- [ ] **Step 6: Import them back into `page.tsx`**

```tsx
import {
  bonusLabel,
  computeStatsFromMeetings,
  flattenSchedule,
  formatDayList,
  makePinId,
  minutesToTime,
  penaltyLabel,
  type Bonus,
  type Meeting,
  type Penalty,
  type Pinned,
} from "@/lib/schedule";
```

Delete the originals. If `tsc` reports an unused import, that helper had no remaining caller in `page.tsx` — remove it from the import list rather than leaving it.

- [ ] **Step 7: Run the tests to watch them pass**

```bash
cd web && npx vitest run
```

Expected: PASS. 17 existing tests plus yours. Report the new total.

- [ ] **Step 8: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx next build
```

- [ ] **Step 9: Commit**

```bash
git add web/lib/schedule.ts web/lib/schedule.test.ts "web/app/(app)/page.tsx"
git commit -m "refactor(web): extract the schedule helpers to lib, with tests

They compute the free-day, gap and latest-end numbers on every result
card and had no coverage. lib/ rather than app/components/ because
vitest.config.ts only includes lib/**/*.test.ts.

Characterization tests were written against the current behaviour first,
so a failure would mean the move changed something."
```

---

### Task 2: Extract the preference domain

**Files:**
- Create: `web/app/components/usePreferences.ts`
- Modify: `web/app/(app)/page.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces, imported by Task 4 and by `page.tsx`:

```ts
export const DAYS: readonly string[];
export const NO_AFTER_TIMES: string[];
export const NO_BEFORE_TIMES: string[];
export type WeightPreset = "Low" | "Med" | "High";
export type GapShape = "no_preference" | "consolidated" | "fragmented";
export const GAP_WEIGHTS: Record<WeightPreset, number>;
export const EARLY_LATE_WEIGHTS: Record<WeightPreset, number>;

export function validateTimeConstraints(
  hardNoBefore: Record<string, DayPref>, hardNoAfter: Record<string, DayPref>,
  softNoBefore: Record<string, DayPref>, softNoAfter: Record<string, DayPref>,
  days: readonly string[],
): string[];

export type DayPrefs = {
  freeDays: string[];
  setFreeDays: (days: string[]) => void;
  noAfter: Record<string, DayPref>;
  setNoAfter: (next: Record<string, DayPref>) => void;
  noBefore: Record<string, DayPref>;
  setNoBefore: (next: Record<string, DayPref>) => void;
};

export type WeightPrefs = {
  gapWeightPreset: WeightPreset;
  setGapWeightPreset: (v: WeightPreset) => void;
  earlyLateWeightPreset: WeightPreset;
  setEarlyLateWeightPreset: (v: WeightPreset) => void;
  preferOneFreeDay: boolean;
  setPreferOneFreeDay: (v: boolean) => void;
  gapShape: GapShape;
  setGapShape: (v: GapShape) => void;
};

export function useDayPrefs(): DayPrefs;
export function useWeightPrefs(): WeightPrefs;
```

`DayPref` is already exported from `web/app/components/DayTimePrefs.tsx` — import it, do not redeclare it.

One deliberate deviation from the spec, which sketched `useDayPrefs(afterDefault, beforeDefault)`: both call sites pass the same two values, `"15:00"` and `"09:00"`, because the hard and soft `useState` initialisers this replaces are identical. Parameters nobody varies are dead flexibility, so the hook takes none and the defaults live inside it. If 3b ever needs them to differ, adding the parameters then is a two-line change.

This is the one task that changes how state is held, so it is also the one that must prove the payload did not move.

- [ ] **Step 1: Create the module**

```ts
"use client";

import { useState } from "react";
import type { DayPref } from "./DayTimePrefs";

/**
 * The preference domain: the constants the controls offer, the validation
 * runOptimize runs, and the state itself.
 *
 * page.tsx still owns this state - it is called from there and feeds the
 * /optimize/ranked payload. It is grouped into hooks so PreferencesPanel
 * takes three props instead of twenty.
 */

export const DAYS = ["Mo", "Tu", "We", "Th", "Fr"] as const;

export type WeightPreset = "Low" | "Med" | "High";
export type GapShape = "no_preference" | "consolidated" | "fragmented";

export const GAP_WEIGHTS: Record<WeightPreset, number> = { Low: 0.05, Med: 0.10, High: 0.20 };
export const EARLY_LATE_WEIGHTS: Record<WeightPreset, number> = { Low: 0.25, Med: 0.50, High: 1.00 };
```

Then move, **verbatim**, from `page.tsx`: `genNoAfterTimes`, `genNoBeforeTimes`, the `NO_AFTER_TIMES` / `NO_BEFORE_TIMES` constants, `timeToMinutes`, and `validateTimeConstraints`. Export the three constants and `validateTimeConstraints`; leave the two generators and `timeToMinutes` unexported — nothing outside this module calls them.

The existing `DAYS`, `GAP_WEIGHTS` and `EARLY_LATE_WEIGHTS` in `page.tsx` are declared with `as const` on the object literals; copy the values exactly as written above and delete the originals.

- [ ] **Step 2: Add the two hooks**

```ts
export type DayPrefs = {
  freeDays: string[];
  setFreeDays: (days: string[]) => void;
  noAfter: Record<string, DayPref>;
  setNoAfter: (next: Record<string, DayPref>) => void;
  noBefore: Record<string, DayPref>;
  setNoBefore: (next: Record<string, DayPref>) => void;
};

/**
 * One set of day preferences - hard or soft. Called twice from page.tsx.
 * The defaults reproduce the four useState initialisers this replaced:
 * every day disabled, no-after at 15:00, no-before at 09:00.
 */
export function useDayPrefs(): DayPrefs {
  const [freeDays, setFreeDays] = useState<string[]>([]);
  const [noAfter, setNoAfter] = useState<Record<string, DayPref>>(() => {
    const init: Record<string, DayPref> = {};
    for (const d of DAYS) init[d] = { enabled: false, time: "15:00" };
    return init;
  });
  const [noBefore, setNoBefore] = useState<Record<string, DayPref>>(() => {
    const init: Record<string, DayPref> = {};
    for (const d of DAYS) init[d] = { enabled: false, time: "09:00" };
    return init;
  });
  return { freeDays, setFreeDays, noAfter, setNoAfter, noBefore, setNoBefore };
}

export type WeightPrefs = {
  gapWeightPreset: WeightPreset;
  setGapWeightPreset: (v: WeightPreset) => void;
  earlyLateWeightPreset: WeightPreset;
  setEarlyLateWeightPreset: (v: WeightPreset) => void;
  preferOneFreeDay: boolean;
  setPreferOneFreeDay: (v: boolean) => void;
  gapShape: GapShape;
  setGapShape: (v: GapShape) => void;
};

export function useWeightPrefs(): WeightPrefs {
  const [gapWeightPreset, setGapWeightPreset] = useState<WeightPreset>("Med");
  const [earlyLateWeightPreset, setEarlyLateWeightPreset] = useState<WeightPreset>("Med");
  const [preferOneFreeDay, setPreferOneFreeDay] = useState(true);
  const [gapShape, setGapShape] = useState<GapShape>("no_preference");
  return {
    gapWeightPreset, setGapWeightPreset,
    earlyLateWeightPreset, setEarlyLateWeightPreset,
    preferOneFreeDay, setPreferOneFreeDay,
    gapShape, setGapShape,
  };
}
```

Check each default against the `useState` call it replaces before deleting the original. `preferOneFreeDay` starts `true`; the two presets start `"Med"`; `gapShape` starts `"no_preference"`.

- [ ] **Step 3: Rewire `page.tsx`**

Replace the ten preference `useState` calls with:

```tsx
const hard = useDayPrefs();
const soft = useDayPrefs();
const weights = useWeightPrefs();
```

Then update every reader. The mapping is mechanical:

| Was | Now |
|---|---|
| `hardFreeDays` / `setHardFreeDays` | `hard.freeDays` / `hard.setFreeDays` |
| `hardNoAfter` / `setHardNoAfter` | `hard.noAfter` / `hard.setNoAfter` |
| `hardNoBefore` / `setHardNoBefore` | `hard.noBefore` / `hard.setNoBefore` |
| `softFreeDays`, `softNoAfter`, `softNoBefore` | the same three on `soft` |
| `gapWeightPreset` / `setGapWeightPreset` | `weights.gapWeightPreset` / `weights.setGapWeightPreset` |
| `earlyLateWeightPreset`, `preferOneFreeDay`, `gapShape` | the same on `weights` |

The readers are in `runOptimize` (the `validateTimeConstraints` call, the four payload loops, the `prefs` object) and in the JSX that Task 4 will move.

- [ ] **Step 4: Verify the payload is byte-identical**

This is the task's gate. Start the servers and preview route, drive **the same five inputs Task 1 recorded**, capture the body the same way, and compare:

```bash
diff <(python3 -m json.tool /tmp/stage3a-payload-baseline.json) <(python3 -m json.tool /tmp/stage3a-payload-after-task2.json)
```

Expected: no output. If it differs, do not commit — report the diff. A changed default or a missed rename shows up here and nowhere else.

- [ ] **Step 5: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 6: Commit**

```bash
git add web/app/components/usePreferences.ts "web/app/(app)/page.tsx"
git commit -m "refactor(web): group the preference state behind two hooks

Ten preference variables and their setters would have made
PreferencesPanel a twenty-prop component. useDayPrefs is called twice,
for hard and soft, and useWeightPrefs once; the panel takes three props.

The constants, timeToMinutes and validateTimeConstraints move with them -
they are the same domain. Payload verified byte-identical against a
baseline captured before the change."
```

---

### Task 3: Extract `Header`

**Files:**
- Create: `web/app/components/Header.tsx`
- Modify: `web/app/(app)/page.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:

```tsx
export function Header(props: Readonly<{
  email: string;
  loading: boolean;
  optimizeDisabled: boolean;
  onShowHelp: () => void;
  onOptimize: () => void;
}>): React.JSX.Element;
```

The smallest region, taken first to establish the pattern the next three follow.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { MessageSquare } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export function Header({
  email,
  loading,
  optimizeDisabled,
  onShowHelp,
  onOptimize,
}: Readonly<{
  email: string;
  loading: boolean;
  optimizeDisabled: boolean;
  onShowHelp: () => void;
  onOptimize: () => void;
}>) {
  return (
    /* lines 550-581 of page.tsx, verbatim */
  );
}
```

Move the header row — the outer `<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" … }}>` at line 550 through its closing tag at 581 — into the return, unchanged. Then rewire only these four references:

- `{email}` stays as is; it is now the prop.
- `onClick={() => setShowHelp(true)}` becomes `onClick={onShowHelp}`.
- `onClick={runOptimize}` becomes `onClick={onOptimize}`.
- `disabled={loading || selectedCourses.length === 0}` becomes `disabled={optimizeDisabled}`.

Everything else — the SVG-free `MessageSquare` icon, the `buttonVariants` anchor, the `ThemeToggle`, every inline style — moves untouched.

- [ ] **Step 2: Use it in `page.tsx`**

```tsx
<Header
  email={email}
  loading={loading}
  optimizeDisabled={loading || selectedCourses.length === 0}
  onShowHelp={() => setShowHelp(true)}
  onOptimize={runOptimize}
/>
```

Remove the now-unused imports from `page.tsx` — `MessageSquare` and `ThemeToggle` at minimum, and `buttonVariants` if the Feedback anchor was its only consumer. `tsc` will not complain about unused imports but `eslint` will.

- [ ] **Step 3: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 4: Verify the header renders identically**

Preview route, both themes. Confirm: title, subtitle and `Logged in as:` line read the same; the theme toggle switches and shows the active option; Feedback is still an anchor that opens the form in a new tab; "How to use?" opens the dialog; Optimize is disabled with no courses selected and reads "Optimizing..." while a request is in flight.

- [ ] **Step 5: Commit**

```bash
git add web/app/components/Header.tsx "web/app/(app)/page.tsx"
git commit -m "refactor(web): extract Header from page.tsx

First of five slices. JSX moves verbatim; the only rewiring is four
references that become props."
```

---

### Task 4: Extract `PreferencesPanel`

**Files:**
- Create: `web/app/components/PreferencesPanel.tsx`
- Modify: `web/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `DayPrefs`, `WeightPrefs`, `DAYS`, `NO_AFTER_TIMES`, `NO_BEFORE_TIMES` from `./usePreferences` (Task 2).
- Produces:

```tsx
export function PreferencesPanel(props: Readonly<{
  hard: DayPrefs;
  soft: DayPrefs;
  weights: WeightPrefs;
  error: string;
}>): React.JSX.Element;
```

The largest region — roughly 200 lines, lines 616–817. It contains the hard box, the soft box, the weights row, and the error message, which renders inside the panel rather than beside it.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DayCheckboxGroup, DayTimeGroup } from "./DayTimePrefs";
import {
  DAYS, NO_AFTER_TIMES, NO_BEFORE_TIMES,
  type DayPrefs, type GapShape, type WeightPrefs, type WeightPreset,
} from "./usePreferences";

export function PreferencesPanel({
  hard,
  soft,
  weights,
  error,
}: Readonly<{ hard: DayPrefs; soft: DayPrefs; weights: WeightPrefs; error: string }>) {
  return (
    /* lines 616-817 of page.tsx, verbatim */
  );
}
```

Move the whole `<div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, maxHeight: … }}>` at line 616 through its close at 817 — the one whose first child is `<h2 …>Preferences</h2>` — including the two explainer `Dialog`s and the trailing `{error && …}`.

Then rewire the six `DayCheckboxGroup` / `DayTimeGroup` call sites and the four weight controls onto the props:

| Was | Now |
|---|---|
| `selected={hardFreeDays} onChange={setHardFreeDays}` | `selected={hard.freeDays} onChange={hard.setFreeDays}` |
| `values={hardNoAfter} onChange={setHardNoAfter}` | `values={hard.noAfter} onChange={hard.setNoAfter}` |
| `values={hardNoBefore} onChange={setHardNoBefore}` | `values={hard.noBefore} onChange={hard.setNoBefore}` |
| the three soft equivalents | the same on `soft` |
| `value={gapWeightPreset} onValueChange={(v) => setGapWeightPreset(v as WeightPreset)}` | `value={weights.gapWeightPreset} onValueChange={(v) => weights.setGapWeightPreset(v as WeightPreset)}` |
| `earlyLateWeightPreset`, `gapShape`, `preferOneFreeDay` | the same on `weights` |

The `idPrefix` values — `hard-free`, `hard-after`, `hard-before`, `soft-free`, `soft-after`, `soft-before` — must survive unchanged. They are the `id`/`htmlFor` pairing that makes clicking a day letter toggle its checkbox.

- [ ] **Step 2: Use it in `page.tsx`**

```tsx
<PreferencesPanel hard={hard} soft={soft} weights={weights} error={error} />
```

Remove imports `page.tsx` no longer uses. After this task it should not import `Checkbox`, `Label`, `DayCheckboxGroup`, `DayTimeGroup`, `Info`, or `NO_AFTER_TIMES` / `NO_BEFORE_TIMES`. It still needs `Select` and friends for the term picker and the compare pickers, and `DAYS` for `runOptimize`.

- [ ] **Step 3: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 4: Verify the panel renders and behaves identically**

Preview route, both themes:

1. Five day checkboxes on one row under each of "Must be free" and "Prefer free" — the grid from stage 2b, not wrapped.
2. Clicking a day **letter** toggles its checkbox.
3. Each cutoff row's dropdown is disabled until its own day is ticked, and ticking `hard-after-Mo` enables only that row — not Tu, not the soft equivalent.
4. Both info dialogs open from their triggers and close on Escape.
5. The four weight controls change and their triggers show labels, not raw values — Gap shape must read `No preference`.
6. An impossible combination still surfaces the error text inside the panel: tick hard no-before Mo at 15:00 and hard no-after Mo at 12:00, click Optimize, and confirm the conflict message appears.

- [ ] **Step 5: Commit**

```bash
git add web/app/components/PreferencesPanel.tsx "web/app/(app)/page.tsx"
git commit -m "refactor(web): extract PreferencesPanel from page.tsx

The largest of the five slices, ~200 lines. Takes three grouped props
rather than twenty individual ones, which is what the hooks in the
previous commit were for."
```

---

### Task 5: Extract `ResultCard` and `ResultsList`

**Files:**
- Create: `web/app/components/ResultCard.tsx`, `web/app/components/ResultsList.tsx`
- Modify: `web/app/(app)/page.tsx`

**Interfaces:**
- Consumes: the helpers and types from `@/lib/schedule` (Task 1).
- Produces:

```tsx
export type OptimizerResult = {
  score: number;
  breakdown: { penalties?: unknown[]; bonuses?: unknown[] };
  schedule: unknown[];
};

export function ResultCard(props: Readonly<{
  result: OptimizerResult;
  index: number;
  isActive: boolean;
  isPinned: boolean;
  onSelect: () => void;
  onPin: () => void;
}>): React.JSX.Element;

export function ResultsList(props: Readonly<{
  results: OptimizerResult[];
  considered: number;
  returned: number;
  activeIdx: number;
  onSelectIdx: (i: number) => void;
  isPinned: (i: number) => boolean;
  onPin: (r: OptimizerResult, i: number) => void;
}>): React.JSX.Element;
```

`ResultCard` is one card: lines 847–962, the `<div role="button">` and everything inside it. `ResultsList` is the surrounding region: the "Results / considered N, returned M" header, the `auto-fit minmax(240px, 1fr)` card grid, and the `TimetableGrid` for the active option.

Deciding `isPinned` in `ResultsList` rather than passing the whole `pinned` array keeps the pin bookkeeping in `page.tsx`, which owns it.

- [ ] **Step 1: Create `ResultCard.tsx`**

```tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  bonusLabel, computeStatsFromMeetings, flattenSchedule, formatDayList, minutesToTime, penaltyLabel,
  type Bonus, type Penalty,
} from "@/lib/schedule";

export type OptimizerResult = {
  score: number;
  breakdown: { penalties?: unknown[]; bonuses?: unknown[] };
  schedule: unknown[];
};

export function ResultCard({
  result,
  index,
  isActive,
  isPinned,
  onSelect,
  onPin,
}: Readonly<{
  result: OptimizerResult;
  index: number;
  isActive: boolean;
  isPinned: boolean;
  onSelect: () => void;
  onPin: () => void;
}>) {
  const ms = flattenSchedule(result.schedule);
  const stats = computeStatsFromMeetings(ms);

  // The gaps penalty and the free-days bonus are already stated exactly
  // above as "Gaps: N min" and "Free days: N (...)", so as chips they only
  // repeat the numbers in a noisier form.
  const penalties = ((result.breakdown?.penalties ?? []) as Penalty[]).filter((p) => p.type !== "gaps_minutes");
  const bonuses = ((result.breakdown?.bonuses ?? []) as Bonus[]).filter((b) => b.type !== "free_days");

  return (
    /* the <div role="button"> from page.tsx, verbatim */
  );
}
```

Move the card's JSX unchanged. Inside it, rename only the references the props replace: `r` becomes `result`, `i` becomes `index`, `setActiveIdx(i)` becomes `onSelect()`, and the pin button's `onClick` body becomes `onPin()` — keeping its `e.stopPropagation()`, which stops a pin click from also selecting the card.

- [ ] **Step 2: Create `ResultsList.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import { TimetableGrid } from "./TimetableGrid";
import { ResultCard, type OptimizerResult } from "./ResultCard";
import { flattenSchedule, penaltyLabel, bonusLabel, type Bonus, type Penalty } from "@/lib/schedule";

export function ResultsList({
  results,
  considered,
  returned,
  activeIdx,
  onSelectIdx,
  isPinned,
  onPin,
}: Readonly<{
  results: OptimizerResult[];
  considered: number;
  returned: number;
  activeIdx: number;
  onSelectIdx: (i: number) => void;
  isPinned: (i: number) => boolean;
  onPin: (r: OptimizerResult, i: number) => void;
}>) {
  return (
    /* lines 820-967 minus the card body, which is now <ResultCard /> */
  );
}
```

Move three things: the results header, the card grid, and — between the grid and the `TimetableGrid` — a **summary block for the selected option** that reads `Score: {active?.score.toFixed(1)}` and lists that option's penalties and bonuses. It is easy to miss because it sits below the cards and reads like part of the grid.

`page.tsx` currently derives two values for these, immediately above its JSX:

```tsx
const active = result?.results?.[activeIdx];
const meetings = useMemo(() => (active ? flattenSchedule(active.schedule) : []), [active]);
```

Both become local to `ResultsList`, computed from its own props:

```tsx
const active = results[activeIdx];
const meetings = useMemo(() => (active ? flattenSchedule(active.schedule) : []), [active]);
```

Delete both from `page.tsx` — after this task nothing there references them, and leaving them is an eslint error. Keep the `TimetableGrid` call exactly as it is, `startHour={8} endHour={20}`.

Note that `active` is optional in `page.tsx` (`result?.results?.[activeIdx]`) and the summary block guards with `active?.`. Keep those guards: `activeIdx` can point past the end of a shorter result set.

- [ ] **Step 3: Use it in `page.tsx`**

```tsx
<ResultsList
  results={result.results}
  considered={result.considered}
  returned={result.returned}
  activeIdx={activeIdx}
  onSelectIdx={setActiveIdx}
  isPinned={(i) => pinned.some((p) => p.term === term && p.sourceIdx === i)}
  onPin={pinResultOption}
/>
```

`pinResultOption` currently takes `(r, idx)` — keep that signature.

- [ ] **Step 4: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 5: Verify results render and behave identically**

Preview route, both themes. Add MATH 1003 and optimize, then confirm:

1. The header reads `considered N, returned M` with the same numbers as before the change.
2. Cards show Option #, score, free days, days on campus, gaps and latest end — with the day on the latest end, e.g. `Tu 11:50`.
3. Clicking a card selects it, the border changes, **the `Score:` summary below the grid updates to that option's score and chips**, and the timetable updates.
4. Keyboard: Enter and Space on a focused card select it.
5. Clicking Pin pins **without** also selecting the card — that is what `stopPropagation` protects.
6. A pinned card's button reads `✅ Pinned` and is filled navy.

- [ ] **Step 6: Commit**

```bash
git add web/app/components/ResultCard.tsx web/app/components/ResultsList.tsx "web/app/(app)/page.tsx"
git commit -m "refactor(web): extract ResultsList and ResultCard from page.tsx

ResultsList decides nothing about pinning - page.tsx still owns the
pinned array and passes isPinned and onPin, so the bookkeeping stays
with the state."
```

---

### Task 6: Extract `CompareSection`

**Files:**
- Create: `web/app/components/CompareSection.tsx`
- Modify: `web/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `Pinned` from `@/lib/schedule` (Task 1).
- Produces:

```tsx
export function CompareSection(props: Readonly<{
  pinned: Pinned[];
  compareA: string;
  compareB: string;
  onCompareA: (id: string) => void;
  onCompareB: (id: string) => void;
  onUnpin: (id: string) => void;
  onRename: (id: string, name: string) => void;
}>): React.JSX.Element;
```

Lines 968–1106: the "Compare Timetables" heading, the pinned list with its rename inputs and unpin buttons, the two A/B `Select`s, and the `CompareTimetableGrid` overlay.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CompareTimetableGrid } from "./TimetableGrid";
import { flattenSchedule, type Pinned } from "@/lib/schedule";

// Base UI reads value="" as "nothing selected" (SelectRoot.js:185), so the
// "(select)" item carries a sentinel mapped back to "" at the state boundary.
const NO_SELECTION = "__none";

export function CompareSection({
  pinned,
  compareA,
  compareB,
  onCompareA,
  onCompareB,
  onUnpin,
  onRename,
}: Readonly<{
  pinned: Pinned[];
  compareA: string;
  compareB: string;
  onCompareA: (id: string) => void;
  onCompareB: (id: string) => void;
  onUnpin: (id: string) => void;
  onRename: (id: string, name: string) => void;
}>) {
  return (
    /* lines 968-1106 of page.tsx, verbatim */
  );
}
```

`NO_SELECTION` moves with the section — `page.tsx` declared it for these two selects and has no other consumer. Confirm that with a grep before deleting it from `page.tsx`.

Rewire `setCompareA` to `onCompareA`, `setCompareB` to `onCompareB`, `unpin` to `onUnpin`, `renamePin` to `onRename`. The sentinel mapping stays inside this component: `onValueChange={(v) => onCompareA(v === NO_SELECTION ? "" : String(v))}`.

- [ ] **Step 2: Use it in `page.tsx`**

```tsx
<CompareSection
  pinned={pinned}
  compareA={compareA}
  compareB={compareB}
  onCompareA={setCompareA}
  onCompareB={setCompareB}
  onUnpin={unpin}
  onRename={renamePin}
/>
```

Keep it inside the same `{result && (…)}` block it lives in today. That is deliberate: pins are session-only state with no persistence, so there can be no pins without a result in the same session.

- [ ] **Step 3: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 4: Verify compare behaves identically**

Preview route, both themes. Optimize, pin two options, then confirm:

1. Both appear in the pinned list.
2. Renaming one updates the text shown in the A and B dropdowns — the rename has to reach their `items`, not just their children.
3. Choosing one in A and another in B renders the overlay grid with both.
4. Unpinning a compared option removes it and clears that selector.
5. With fewer than two pinned, the "Pin at least 2 options to enable comparison" hint shows.

- [ ] **Step 5: Commit**

```bash
git add web/app/components/CompareSection.tsx "web/app/(app)/page.tsx"
git commit -m "refactor(web): extract CompareSection from page.tsx

Last of the five slices. The NO_SELECTION sentinel moves with it - the
two compare selects were its only consumers."
```

---

### Task 7: Verify the whole stage

**Files:**
- Modify: none expected. If a step here requires a change, make it and say so.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Confirm the split actually happened**

```bash
cd web && wc -l "app/(app)/page.tsx" app/components/{Header,PreferencesPanel,ResultsList,ResultCard,CompareSection}.tsx app/components/usePreferences.ts lib/schedule.ts
```

Expected: `page.tsx` well under 500 lines, down from 1,148, and no new file over ~250. Report the numbers. If `page.tsx` is still over 500, some region did not move — say which.

- [ ] **Step 2: Confirm no visual change was smuggled in**

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer
git diff master...HEAD -- web/app web/components | grep "^+" | grep -oE 'className="[^"]*"' | sort | uniq -c | sort -rn | head -30
```

Every `className` on an added line should be one that existed on the corresponding removed line. Spot-check the top ten against `git diff master...HEAD` and report anything that looks new rather than moved. Then:

```bash
git diff master...HEAD -- web/app web/components | grep "^+" | grep -oE '#[0-9a-fA-F]{3,8}\b|"white"|"crimson"' | sort -u || echo "  no colour literals"
```

- [ ] **Step 3: Confirm the `system-ui` bug is still there**

```bash
cd web && grep -n 'system-ui' "app/(app)/page.tsx"
```

Expected: still present. It belongs to stage 3b, which ships it alone. If it is gone, someone fixed it out of scope — report that.

- [ ] **Step 4: Full gate**

```bash
cd api && .venv/bin/pytest tests/ -q
cd ../web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: 74 Python; vitest at 17 plus the schedule tests from Task 1; `tsc` and `next build` clean; `eslint` at its two pre-existing problems.

- [ ] **Step 5: Payload byte-identical, end to end**

Drive the same five inputs Task 1 recorded, capture the body, and diff against the baseline:

```bash
diff <(python3 -m json.tool /tmp/stage3a-payload-baseline.json) <(python3 -m json.tool /tmp/stage3a-payload-final.json)
```

Expected: no output.

- [ ] **Step 6: Whole-app pass, both themes**

Preview route plus API. Walk the flow end to end and report each: add two courses; pin a lecture on one; set a hard free day and a cutoff; optimize; select different result cards; pin two; rename one; compare them; unpin one; open both explainer dialogs and the help dialog.

Console must show no errors, no warnings, and no hydration mismatch.

- [ ] **Step 7: Clean up**

```bash
cd web && rm -rf app/preview-tmp .next/types .playwright-mcp && cd .. && rm -f /tmp/stage3a-payload-*.json && git checkout -- web/proxy.ts; git status --short
```

Expected: clean apart from the repo's pre-existing untracked `kite-export.mp4`. **Verify `web/proxy.ts` exists** — a missing proxy silently disables authentication.

- [ ] **Step 8: Commit**

Only if a step above required a change. Otherwise report that no commit was needed — a verification task with an empty diff is a success, not a gap.

---

## Notes for the implementer

- **This stage is a move, not an improvement.** If you find yourself tidying a style object, renaming something for clarity, or fixing a bug you noticed, stop and note it in your report instead. Stage 3b is three weeks of redesign work and it wants a clean base. The one exception is the `system-ui` line, which is explicitly reserved for 3b.
- **The payload check is the real gate.** Rendering identically is checked by eye and eyes miss things; a byte-identical request body is checked by `diff`. Task 2 is where it can break, because that is the only task that changes how state is held.
- **`next dev` never exits.** Background it in every task that needs a browser, or the task hangs until it times out.
- **Delete `web/.next/types` after removing the preview route.** A stale `validator.ts` referencing the deleted route makes `tsc` fail with `TS2307` and looks like a real type error.
- **The `idPrefix` values in Task 4 are load-bearing.** They form the `id`/`htmlFor` pairs that make clicking a day letter toggle its checkbox — verified working in stage 2b, and easy to break silently while moving JSX.
- Stage 3b does the redesign; stage 3c does responsive. If a task tempts you toward either, that is the other plan.
