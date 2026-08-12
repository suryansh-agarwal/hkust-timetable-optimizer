# Stage 3 — Layout, Typography and Responsive — Design

Parent spec: `docs/superpowers/specs/2026-08-09-shadcn-redesign-design.md`, which
covers all four stages of the shadcn/ui adoption. Stages 1, 2a and 2b have
shipped. This document supersedes that spec's short "Stage 3" section, which
described the work before its scope was settled.

## Problem

Stages 1–2b replaced the app's components. They did not touch its layout, its
type, or its behaviour below a laptop screen. Measured against the current
tree at `ec4c70d`:

| | |
|---|---|
| `web/app/(app)/page.tsx` | **1,148 lines**, 26 state variables, 67 inline styles |
| Inline `style={{}}` across app code | **146** (down from 237 at stage 1) |
| Hardcoded `gridTemplateColumns: "1fr 1fr"` with no breakpoint | 2 |
| Responsive prefixes in app code | 7, all `sm:max-w-*` on dialogs |
| Sign-out | none, anywhere |

Three specific defects follow from this:

- **The app renders in the wrong font.** `page.tsx:549` sets
  `fontFamily: "system-ui"` on the root `<div>`, overriding the Geist face
  `layout.tsx` loads and stage 1 mapped into `@theme`. Every screen has been
  system-ui since before this redesign began.
- **Below ~900px the two columns simply squeeze.** There is no breakpoint to
  stack them. The owner tests on real iOS and Android devices.
- **The result card leads with a number that cannot guide a choice.** It reads
  `Score 240.0`. In a representative run the six returned options scored
  240.0, 240.0, 240.0, 239.0 — the absolute value is meaningless to a student
  and the differences are within a point, so the headline number is doing no
  work.

## Goal

Bring the interface to a designed standard and make it usable on a phone,
without a single unreviewable diff and without regressing what now works.

## Decomposition

The work is three problems with different risk profiles, so it is three
sub-stages, each on its own branch with its own implementation plan, in order.
Bundling them would mean one diff across nine files mixing a structural
refactor with a visual rewrite — the same mistake stage 2 avoided by splitting
into 2a and 2b.

| | Deliverable | Gate |
|---|---|---|
| **3a** | `page.tsx` split into five components | Renders identically; `/optimize/ranked` payload byte-identical |
| **3b** | Desktop redesign | Every surface deliberately styled; no inline styles left outside the timetable grid |
| **3c** | Responsive behaviour | Usable at 375px |

3a runs first because it is the highest-risk single change in the whole
redesign — it moves state across module boundaries — and because everything
after it then operates on small files rather than a 1,148-line one.

---

## 3a — The split

### File structure

| File | Responsibility |
|---|---|
| `web/app/(app)/page.tsx` | state ownership and composition only |
| `web/app/components/Header.tsx` | title, subtitle, identity line, theme toggle, feedback link, help trigger, Optimize |
| `web/app/components/PreferencesPanel.tsx` | hard box, soft box, weights and style |
| `web/app/components/ResultsList.tsx` | the card grid, active selection, the selected schedule's grid |
| `web/app/components/ResultCard.tsx` | one option |
| `web/app/components/CompareSection.tsx` | pinned list, A/B pickers, overlay grid |

`CoursePicker.tsx`, `DayTimePrefs.tsx` and `TimetableGrid.tsx` keep their
current responsibilities and are not restructured.

### State ownership

`page.tsx` keeps every piece of state. It is the page's state: it feeds
`runOptimize`, and the Supabase persistence effects already live there.

Ten of the twenty-six state variables are preferences — `hardFreeDays`,
`softFreeDays`, `hard`/`softNoAfter`, `hard`/`softNoBefore`,
`gapWeightPreset`, `earlyLateWeightPreset`, `preferOneFreeDay`, `gapShape`.
Passing them and their setters individually would give `PreferencesPanel`
twenty props. Instead, 3a groups the six day-related ones behind two calls to
a hook in a new `web/app/components/usePreferences.ts`:

```ts
export type DayPrefs = {
  freeDays: string[];
  setFreeDays: (days: string[]) => void;
  noAfter: Record<string, DayPref>;
  setNoAfter: (next: Record<string, DayPref>) => void;
  noBefore: Record<string, DayPref>;
  setNoBefore: (next: Record<string, DayPref>) => void;
};

export function useDayPrefs(afterDefault: string, beforeDefault: string): DayPrefs;
```

Called twice from `page.tsx` — `const hard = useDayPrefs("15:00", "09:00")`
and `const soft = useDayPrefs("15:00", "09:00")` — reproducing the four
existing `useState` initialisers exactly. `PreferencesPanel` then takes three
props: `hard`, `soft`, and a `weights` group.

The four remaining preference variables — the two weight presets,
`preferOneFreeDay` and `gapShape` — pass as one `weights` object without a
hook; they have no shared shape worth abstracting.

**This is the one place 3a goes beyond a pure move**, and it is deliberate: a
split that relocates a twenty-argument interface has not reduced any
complexity. Every other line of JSX, including all inline styles, moves
unchanged.

### What must not change

`runOptimize` builds a `Prefs` object with these exact keys:
`prefer_one_free_day`, `gap_shape`, `hard_free_days`, `hard_no_after`,
`hard_no_before`, `soft_free_days`, `soft_no_after`, `soft_no_before`, and a
`weights` object of `gaps_per_min`, `late_after_per_min`,
`early_before_per_min`. The `*_no_after` / `*_no_before` maps are built from
enabled days only. After the split, `buildPrefs` reads `hard.freeDays` where it
read `hardFreeDays` — a mechanical rename. **The serialised request body must
be byte-identical**, and that is the task's gate, verified by capturing the
outgoing request before and after.

`validateTimeConstraints` keeps its current signature and call site.

### Verification

- Both themes render indistinguishably from `ec4c70d`, checked side by side.
- A recorded `/optimize/ranked` request body matches the pre-split body exactly
  for the same inputs.
- 74 Python, 17 vitest, `tsc`, `eslint` at its two pre-existing problems,
  `next build` clean.

---

## 3b — Desktop redesign

### The font fix

Delete `fontFamily: "system-ui"` from `page.tsx:549`. One line, and it changes
every screen, so it ships early in the stage and is checked on its own.

### Scale

A spacing and type scale applied consistently rather than the current
per-element `fontSize: 13` / `fontSize: 14` / `marginTop: 10`. Tailwind's
defaults are the scale; the work is choosing one step per role and using it
everywhere. Card, Badge, Separator and Tooltip are adopted here — they were
deliberately deferred out of stage 2b because they are surface components and
this is the pass that designs the surfaces.

The remaining 146 inline styles are retired region by region as each is
restyled. `TimetableGrid.tsx`'s 26 are excluded: that file is stage 4.

### Result cards

The card leads with a **relative score bar** scaled against the best result in
the set, so two options a point apart read as two near-identical bars rather
than two unexplained numbers. The best option is labelled as such; the others
show their delta. Beneath it, the facts that actually differentiate: free days,
latest end, gaps, days on campus.

The raw score stays available as secondary text — it is real information and
removing it would be a regression for anyone who has learned to read it.

### Compare

Currently the last thing on the page, below the results and the selected
schedule. It is promoted so that pinning and comparing read as one flow rather
than a feature discovered by scrolling.

### Empty states

`No courses selected.` and `Start typing to search courses.` currently carry
the whole burden of an empty app. They get designed treatment — the first
screen a new user sees is the one with nothing in it.

---

## 3c — Responsive

- Both `gridTemplateColumns: "1fr 1fr"` grids become single-column below the
  breakpoint.
- The hard and soft preference boxes become collapsible, so a phone is not a
  single column of thirty controls.
- Tap targets to 44px, matching the treatment the login page received in
  `ec4c70d`.
- **The timetable grid keeps its desktop proportions inside a horizontally
  scrollable container.** Decided deliberately: at 375px, five day columns plus
  the 80px time gutter give roughly 59px per day, which truncates course codes.
  A day-at-a-time mobile mode is the better end state but is a second rendering
  mode for the most complex component in the app, and it belongs with stage 4
  rather than pulled forward into a layout pass.

Breakpoint: Tailwind's `lg` (1024px) for the column stack, chosen because the
two-column body already crowds below roughly 900px.

---

## Explicitly out of scope

- **The timetable grid's internals.** Stage 4 owns them: subject hues retuned
  in OKLCH, denser blocks, hover and focus states, and a mobile rendering mode.
- **Sign-out.** There is none anywhere in the app, and the header currently
  reads `Logged in as: none`. That is a missing feature, not a styling defect.
  3b designs the header to leave room for an account control without building
  one. It will be conspicuous once the header looks finished, and it should be
  its own piece of work.
- Any backend, scraper or optimiser change.
- Animation libraries beyond what shadcn components include.
- A marketing or landing page.

## Risks

- **3a moves state across module boundaries.** Mitigated by shipping it alone
  with an identical-render gate and a byte-identical payload check, so any
  regression is bisectable to one commit.
- **3b touches every surface.** Mitigated by 3a landing first: each region is
  then a file small enough to review whole.
- **The two hooks in 3a are the only non-mechanical part of an otherwise
  mechanical change.** If they turn out to complicate rather than simplify, the
  fallback is plain grouped-object props with no hook, which is a local change
  to one file.
- **A cascade-layer regression.** Stage 2a shipped a Critical when an unlayered
  rule in `globals.css` outranked Tailwind's `@layer utilities`, invisible in
  one theme. 3b edits colours across the app; the standing rule recorded in
  `globals.css` — never set a colour on an element selector outside
  `@layer base` — applies to every task.

## Verification

Per sub-stage: `npx tsc --noEmit`, `npx eslint .` (two pre-existing problems
are the baseline), `npx vitest run`, `npx next build`, and the Python suite
untouched at 74.

Visual verification uses the established preview-route method: a temporary
`app/preview-tmp/page.tsx` rendering the gated page component with
`web/proxy.ts` removed for the duration and restored before any commit. Both
themes, every time. That method has caught, across this redesign, a raw-type
summary line, a light-theme contrast failure invisible in dark mode, twenty
invisible controls, and popups collapsed to a 144px floor — none of which any
automated check reported.

3c additionally verifies at 375px, and confirms no horizontal page scroll at
that width — the timetable grid scrolls inside its own container, the page
body does not.
