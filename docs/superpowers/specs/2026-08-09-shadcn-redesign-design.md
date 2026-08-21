# shadcn/ui Adoption and UI Redesign — Design

## Problem

The web app is styled entirely with inline `style={{}}` objects driven by CSS
variables. Measured against the current tree:

| | |
|---|---|
| Inline `style={{}}` blocks | **237** across 9 files |
| Tailwind classNames in app code | **0** |
| Tailwind CSS | installed and wired through PostCSS, **entirely unused** |
| `web/app/(app)/page.tsx` | 1,322 lines, 134 of those style blocks |
| Component library, primitives, CVA | none |

The consequences are concrete rather than aesthetic:

- Controls are native `<select>` and `<input>` elements. The professor and
  section pickers are long lists in a native dropdown with no search, no
  keyboard affordances beyond the browser default, and no ARIA beyond what the
  element gives for free.
- Interaction states are hand-rolled per element with `onMouseEnter` /
  `onMouseLeave` handlers that mutate `style.background` directly. There is no
  consistent focus ring, and `:focus-visible` is defined once globally rather
  than per control.
- Icons are emoji (`🔎 📌 ❌ ✅`), which render differently across platforms and
  carry no accessible name.
- Every new surface repeats the same twenty-line style object.

Tailwind being installed but unused means the largest prerequisite for adopting
shadcn/ui is already paid for.

## What shadcn/ui is

Worth stating precisely, because it shapes the work: **it is not an installable
component library.** There is no runtime package to import components from. A
CLI copies component *source* into the repository (`components/ui/button.tsx`)
and the project owns it thereafter. It is a code generator plus a design
system.

Adoption introduces real dependencies the project does not have. Verified by
running `shadcn init` against a throwaway copy of this app rather than taken
from the docs, because the CLI has changed:

- **`@base-ui/react`** — the primitive library. The current default style is
  `base-nova`, and generated components import from `@base-ui/react/*`.
  **Not Radix.** An earlier draft of this spec said Radix; that was wrong.
  Radix is still selectable via `--base radix`, but the default is Base UI and
  this project takes the default.
- `class-variance-authority`, `clsx`, `tailwind-merge` — variant and class
  merging, used by every generated component
- `lucide-react` — icons
- `tw-animate-css` — animation utilities the components reference
- `shadcn` itself, as a runtime dependency, because the generated
  `globals.css` does `@import "shadcn/tailwind.css"`
- `next-themes` — not installed by the CLI; added by this stage for theming

It also writes `components.json` and `lib/utils.ts` containing `cn()`.

Verified: shadcn/ui supports **Tailwind v4 and React 19**, this project's
stack, and uses CSS-first `@theme inline` configuration rather than a
`tailwind.config.js`. `init` correctly detects Next.js and Tailwind v4 here.

**`init` appends new tokens, and overwrites existing ones that share a name.**
Confirmed by running it: it left every token name intact (nothing was dropped)
but rewrote the values of the names shadcn also uses, and added
`@custom-variant dark (&:is(.dark *))` plus a `.dark {}` block alongside the
existing `@media (prefers-color-scheme: dark)`, taking `globals.css` from 219
to 372 lines with two theme mechanisms live at once.

The overwrites are not cosmetic. In this app they replaced `--accent`
(`#003366`, the HKUST navy every primary button uses) with shadcn's pale grey
hover surface, replaced `--border`, decoupled `--background`/`--foreground`
from their aliases, and turned a working `--font-sans: var(--font-geist-sans)`
into a circular `var(--font-sans)`.

The practical consequence for every stage: **treat any `shadcn` CLI run as
destructive to same-named tokens.** Run it as its own commit so the damage is
visible in one diff, and re-check the token block afterwards. Reconciling this
is the substance of stage 1, not the `init` command.

It does **not** modify `layout.tsx`. Its "Updating fonts" step only writes
`--font-sans: var(--font-sans)` into `@theme`, and this app defines
`--font-geist-sans`, so the sans font silently falls back until that is
mapped.

## Goal

Adopt shadcn/ui as the component and design foundation, and bring the interface
to a modern standard, without a single unreviewable rewrite and without
degrading anything that currently works.

## Decisions

Settled during brainstorming:

1. **Staged adoption**, four stages, each merging independently. Not a
   big-bang rewrite of all nine files.
2. **Class-based dark mode** via `next-themes`, replacing
   `@media (prefers-color-scheme: dark)`, with a System / Light / Dark toggle.
3. **Palette**: shadcn's **slate** base with **HKUST navy as `--primary`**,
   rather than shadcn's default near-black primary. Slate rather than neutral,
   gray, zinc or stone because it is the cool-toned option, and the existing
   dark canvas is already navy-tinted (`#0d131f`); a pure-grey base would sit
   badly against a navy primary.
4. **The timetable grid stays custom.** It is absolute-positioned scheduling
   with lane packing; no component library provides that, and wrapping it in
   one would be worse.

## Theming

shadcn's convention is a `.dark` class on the root element. The app currently
switches on `@media (prefers-color-scheme: dark)`. These are different
mechanisms and the difference is not cosmetic: every component or block copied
from the shadcn docs assumes `.dark`, so staying on media queries would mean
hand-editing each one indefinitely.

Moving to `next-themes` costs one dependency and requires
`suppressHydrationWarning` on `<html>` to avoid a first-paint mismatch. It buys
an explicit theme toggle, defaulting to System so current behaviour is
preserved for anyone who never touches it.

The help modal's line "The app follows your system light or dark theme" becomes
inaccurate and must be updated in the same stage.

## Token migration

The current system has 52 custom properties. shadcn expects a specific set.
Most map cleanly:

| Current | shadcn |
|---|---|
| `--bg` | `--background` |
| `--text` | `--foreground` |
| `--surface` | `--card`, `--popover` |
| `--surface-2` | `--muted` |
| `--border` | `--border`, `--input` |
| `--text-muted`, `--text-subtle`, `--text-faint` | `--muted-foreground` |
| `--accent`, `--accent-hover`, `--accent-fg` | `--primary`, `--primary-foreground` |
| `--danger*` | `--destructive`, `--destructive-foreground` |
| `--active-border` | `--ring` |

Three groups have no shadcn equivalent and are kept as app-specific tokens:

- `--sub-1` … `--sub-8`, the per-subject hues the timetable derives fill,
  border and label from
- `--cmp-a`, `--cmp-b`, the two compare-view hues
- `--warn-bg` / `--warn-text`, used by the matching-requirement badge

`--success*`, `--pin*` and `--selected-bg` fold into shadcn's `--primary` and
`--accent` roles rather than surviving as separate names.

Colours move to OKLCH, which is what the shadcn CLI writes and what Tailwind v4
expects. The brand values convert to:

| Role | Hex | OKLCH |
|---|---|---|
| `--primary` light | `#003366` | `oklch(0.3233 0.1025 253.89)` |
| `--primary` dark | `#2f6fb0` | `oklch(0.5324 0.1214 251.48)` |

The CLI's default `baseColor` is `neutral`, which is chroma-0 grey. This
project sets `slate` instead, per decision 3.

## Stages

Each stage is an independent branch that ships on its own, and **each gets its
own implementation plan** rather than one plan covering all four. They are
sequenced, not parallel: stage 3 restructures code that stage 2 rewrites, so
planning it before stage 2 lands would plan against code that no longer exists.

This spec is the shared design for all four; `writing-plans` runs once per
stage, at the point that stage begins.

### Stage 1 — Foundation

`shadcn init`, dependency installation, the token migration above, and the
switch to `next-themes` with a header toggle.

**This stage visibly changes colours across the whole app.** It is not
invisible plumbing, and both themes need checking before merge.

### Stage 2 — Primitives

Replace hand-rolled and native controls with shadcn components: Button, Select,
Card, Dialog, Input, Checkbox, Badge, Label, Sonner, Tooltip, Separator.

This is where the quality arrives. Base UI provides keyboard navigation, focus
management and screen-reader semantics that inline styles cannot. It matters
most for the professor and section pickers, which are currently native selects
holding long option lists.

`InfoModal` is replaced by Dialog and `Toast` by Sonner; both are then deleted
rather than left alongside their replacements. `lucide-react` icons replace the
emoji.

### Stage 3 — Layout and typography

The visible redesign: spacing scale, type hierarchy, result cards, empty
states, responsive behaviour.

This stage also **splits `page.tsx`**. At 1,322 lines it is the worst file in
the repository and migration makes it longer. It breaks into `Header`,
`PreferencesPanel`, `ResultsList`, `ResultCard` and `CompareSection`. This is
part of the work, not an unrelated refactor: the file cannot be reviewed or
safely edited at its current size.

### Stage 4 — Timetable grid

Stays custom. Gets a polish pass: subject hues retuned in OKLCH, denser blocks,
proper hover and focus states, and consistent use of the new tokens.

## Verification

Per stage: `npx tsc --noEmit`, `npx eslint`, `npx vitest run` and
`npx next build` must all be clean, and the Python suite must be untouched at
74 passing.

Visual verification uses the established approach — a temporary preview route
importing the page component, driven with Playwright, screenshotted in both
themes. That method caught a raw-type summary line that the diff alone did not
show, so it is a requirement rather than a nicety.

Additional checks specific to this work:

- No hardcoded colour literals introduced. The existing audit (`grep` for hex
  and named colours in the diff) applies to every stage.
- Auth still gates: `/` redirects to `/login`, `/login` and `/request-access`
  stay public. Stage 1 touches the root layout, which is where the theme
  provider mounts.
- No hydration mismatch warning in the console after the theme switch.

## Risks

- **Stage 1 changes every colour at once.** Mitigated by shipping it alone, so
  a regression is bisectable to one commit.
- **Hydration flash** from `next-themes` if the provider is misconfigured.
  Caught by the console check above.
- **Half-migrated period** between stages, where some surfaces use shadcn
  components and others still use inline styles. Accepted deliberately: the
  alternative is one diff spanning nine files and 237 style blocks.
- **`page.tsx` splitting in stage 3 is the highest-risk single change**, since
  it moves state across module boundaries. It is sequenced after the primitives
  land so the moved code is already in its final form.

## Explicitly out of scope

- Animation libraries beyond what shadcn components include
- A marketing or landing page
- Any backend, scraper or optimiser change
- Charts and analytics
- Replacing the timetable grid with a third-party scheduler

## Carried into stage 4

Stage 3c's final whole-branch review raised seven Minor findings that were
deliberately not fixed on that branch. They are recorded here rather than in
the stage's scratch ledger, which is deleted when the stage merges.

- **The two `min-w-[720px]` literals** (`ResultsList.tsx`, `CompareSection.tsx`)
  are the timetable's own geometry — an 80px time gutter plus five day columns
  — duplicated as a magic number with no comment tying them to it. Stage 4
  rewrites that geometry, and nothing currently points either literal at the
  change.
- **`page.tsx`'s `mb-3` and `mt-1`** are flex children of a `p-5` Card, so they
  render 28px and 20px rather than the 12px and 4px they name. This is the
  add-trap stage 3c was written to close, and `mb-3` is not a step on the
  scale at all. Both were outside every task's declared file list.
- **The mobile first paint flashes both preference panels open, then
  collapses them.** `useEffect` commits after paint, so the server-rendered
  `defaultOpen` markup is painted before the key change remounts the subtree
  closed. `useSyncExternalStore` would remove the `eslint-disable` but not the
  flash — the server snapshot is still a fixed value. A CSS-driven collapse
  would.
- **`PreferencesPanel`'s `max-h-[520px] overflow-y-auto` makes the panel a
  scroll container on both axes** (CSS computes the visible axis to `auto`
  when the other is not visible), as does `CoursePicker`'s `max-h-80`. This
  matters beyond the panels themselves: the page-level
  `document.scrollWidth === clientWidth` check that stage 3c leaned on is
  blind to anything overflowing inside them. Nothing overflows today — the
  widest mobile row measures ~223px — but the check is weaker than it looks,
  and stage 4 should not trust it alone.
- **Collapsed panels unmount**, so find-in-page cannot reach hidden
  preferences on a phone. `hiddenUntilFound` on `CollapsibleContent` is a
  one-prop fix whenever the collapsible is next touched.
- **About twenty `size="sm"` select triggers are 28px tall.** Stage 3c raised
  seven controls to 44px below `lg`; these are the same tap-target question at
  roughly three times the count, and they are what a phone user actually
  touches most. Worth deciding before stage 4 rather than after.
- The scale table in the stage 3c plan still reads `px-6` for the page
  container; the shipped value is `px-4 py-5 lg:px-6`.
