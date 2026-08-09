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
| Component library, Radix, CVA | none |

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

Adoption introduces real dependencies the project does not have: Radix UI
primitives (per component), `class-variance-authority`, `clsx`,
`tailwind-merge`, `lucide-react` for icons, and `next-themes` for theming. It
also adds `components.json` and `lib/utils.ts` containing the `cn()` helper.

Verified against the current docs: shadcn/ui supports **Tailwind v4 and React
19**, which is this project's stack, and uses CSS-first `@theme inline`
configuration rather than a `tailwind.config.js`.

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
expects.

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

This is where the quality arrives. Radix provides keyboard navigation, focus
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
