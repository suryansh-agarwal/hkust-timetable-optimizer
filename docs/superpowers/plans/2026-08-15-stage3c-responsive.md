# Stage 3c — Responsive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app usable at 375px, and settle the four scale inconsistencies stage 3b's review found before they propagate.

**Architecture:** Stage 3b restyled six surfaces onto one scale but left four places where the same semantic role got different classes, and a scale table that omits two steps the code actually uses. This stage fixes those first, then adds the breakpoints: the two-column grids stack, the preference boxes collapse, fixed control widths go fluid, and the timetable grid scrolls horizontally inside its own container without stage 4's file being touched.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui `base-nova` over `@base-ui/react`, Vitest.

**Design spec:** `docs/superpowers/specs/2026-08-12-stage3-layout-and-responsive-design.md`

**Branch:** all tasks land on `feature/stage3c-responsive`, cut from `master`. Create it before Task 1:

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer && git checkout -b feature/stage3c-responsive
```

## The corrected scale

Stage 3b's table was incomplete in two ways that its own review caught. This is the authoritative version; work against it, not against the 3b plan.

| Role | Class |
|---|---|
| Page container | `mx-auto w-full max-w-6xl px-6 py-5` |
| Section stack | `space-y-6` |
| Card padding | `p-5` — compact grid items use `Card size="sm"` + `px-3` |
| Gap, default | `gap-4` |
| Gap, tight pair | `gap-2` |
| Gap, tight vertical group | `gap-1` |
| **Label above a control group** | **`mb-2` on the label** |
| Caption under its parent | `mt-1` |
| Section-level separation | `mt-6` |
| Panel padding (error panels, empty states) | `p-3` / `p-6` respectively |
| Page title | `text-3xl font-semibold tracking-tight` |
| Section heading | `text-lg font-semibold` |
| Sub-heading | `text-sm font-semibold` |
| Body | `text-sm` |
| Secondary | `text-sm text-muted-foreground` |
| Fine print | `text-xs text-muted-foreground` |
| Numerics | `tabular-nums` |

**`gap-3` remains forbidden in hand-written classes.** Never derive a class from an old pixel value.

**Two things the 3b table omitted, now stated:**

1. **`mb-2` is a real step.** It shipped at eight sites for label-above-control and is the right answer; it was simply missing from the table, which is why one implementer reached for `mt-2` on a sibling instead.
2. **The `Card` primitive contributes its own vertical rhythm.** `web/components/ui/card.tsx` is `flex flex-col gap-(--card-spacing)` with `[--card-spacing:--spacing(4)]` and `data-[size=sm]:[--card-spacing:--spacing(3)]`. So every default Card has a **16px** internal gap and every `size="sm"` Card has **12px** — including `ResultCard` and the CoursePicker course chips. That 12px is not a violation; it is vendored, and this stage does not fight it.

**The trap that follows from it:** flex gaps **add** to margins rather than collapsing. A `mt-6` on a flex child of a Card renders 16 + 24 = **40px**, not 24px. Stage 3b shipped two commits that targeted numbers which are not what renders — Task 2 corrects them. Before adding a margin inside a Card, ask whether the Card's own gap already provides the separation.

## Global Constraints

Every task's requirements implicitly include this section.

- **Never add a colour rule outside a cascade layer.** Stage 2a shipped a Critical when an unlayered `button { color: var(--foreground) }` in `globals.css` outranked Tailwind's `@layer utilities` — unlayered declarations beat layered ones regardless of specificity — invisible in dark mode because `--foreground` and `--primary-foreground` are equal there.
- **No hex or named colour literals.** Arbitrary-value classes for tokens absent from `@theme inline` are legitimate and settled: `--danger`, `--danger-bg`, `--danger-border`, `--danger-chip-bg`, `--pin-text`, `--success-bg`, `--success-border`, `--login-canvas`, `--login-badge`, `--active-border`, `--cmp-a`, `--cmp-b`.
- **Contrast is a gate, not a preference.** Stage 3b shipped penalty badges at 3.30:1 in light and 3.50:1 in dark against AA's 4.5:1, using a token `globals.css:90-93` documents as unusable for text. If a task changes a text colour, measure it.
- **Exactly three inline styles exist in app code** and must stay exactly three: the score bar's runtime width (`ResultCard`), and the two compare swatch colours (`CompareSection`). `TimetableGrid.tsx`'s 26 are stage 4's.
- **Do not touch `web/app/components/TimetableGrid.tsx`.** Its horizontal scroll is achieved from outside it — Task 5 shows how.
- Do not touch `web/lib/sectionOptions.ts`, `web/lib/schedule.ts` (its 42 tests must keep passing untouched), or `web/app/components/usePreferences.ts`.
- **No behaviour change and no `/optimize/ranked` payload change.** The section-lock `ANY` sentinel and `items` props; the six `idPrefix` values that make clicking a day letter toggle its checkbox; `NO_SELECTION` on both compare selects; `e.stopPropagation()` on the pin button; `role="button"` / `tabIndex` / Enter-and-Space on the card; the `active?.` guards; the Supabase OAuth and OTP calls — all stay.
- The three login controls stay at `h-11`; Copy-email stays `variant="default"`.
- `web/proxy.ts` is the auth gate. Tasks needing a browser **delete** it and restore it with `git checkout --`. **Never edit it.** An agent in stage 3b edited it to short-circuit the gate and was killed before restoring it, leaving authentication disabled in the working tree. A deleted file is obvious in `git status`; an edited one looks like work in progress.
- Python backend untouched: `api/` stays at 74 passing tests. Vitest stays at 42.
- Lint baseline: `npx eslint .` reports two PRE-EXISTING problems — `prefer-const` in `app/auth/callback/route.ts`, `@next/next/no-img-element` in `app/login/page.tsx`. Neither is in scope; both must still be present afterwards.

## The breakpoint

**`lg` (1024px)** for the column stack, per the spec. Below it the app is one column; at and above it, today's two-column layout is unchanged.

Tailwind is mobile-first: an unprefixed class applies everywhere and `lg:` overrides it from 1024px up. So `grid-cols-1 lg:grid-cols-2` is the shape — **not** `grid-cols-2 md:grid-cols-1`, which would be backwards and is the most common way to get this wrong.

## Reaching the app in a browser

`/` redirects to `/login`, so the gated page needs a preview route:

```bash
mkdir -p web/app/preview-tmp && cat > web/app/preview-tmp/page.tsx <<'EOF'
"use client";
import Home from "../(app)/page";
export default function PreviewPage() { return <Home />; }
EOF
rm web/proxy.ts
cd web && npx next dev --port 3000
```

`next dev` **must** run in the background — it never exits, and a foreground run hangs the task until it times out. Poll `http://localhost:3000/preview-tmp` with `curl` until it returns 200. If a stale server holds the port: `lsof -ti:3000 | xargs kill`.

Tasks needing real results also need the API, backgrounded:

```bash
cd api && MINICATALOG_PATH="../web/public/course-index/{term}.json" .venv/bin/python -m uvicorn main:app --port 8000
```

Port 3000 is mandatory — the API's CORS allowlist contains only that origin.

Resize with Playwright's `browser_resize` to **375 × 812** (iPhone-class) for the narrow checks, and back to **1280 × 800** to confirm the desktop layout is unchanged.

Before committing:

```bash
rm -rf web/app/preview-tmp web/.next/types .playwright-mcp web/.playwright-mcp
git checkout -- web/proxy.ts
ls -la web/proxy.ts   # confirm it exists - a missing proxy disables auth
```

Deleting `web/.next/types` matters: a stale `validator.ts` referencing the removed preview route makes `tsc` fail with `TS2307`.

**A note on iCloud.** This repo has produced `foo 2.tsx` duplicates six times. `.gitignore` catches them so they cannot be committed, but they appear on disk and in greps. If a count looks doubled, check for a `" 2.tsx"` twin before believing it.

## File Structure

| File | This stage's change |
|---|---|
| `web/app/components/CoursePicker.tsx` | error panel and two empty states normalised; search row fluid |
| `web/app/components/PreferencesPanel.tsx` | hard/soft stack and collapse; weights row fluid; the 40px margin corrected |
| `web/app/components/CompareSection.tsx` | heading to `h2`; Card padding; selects fluid |
| `web/app/components/ResultsList.tsx` | inert wrapper removed; grid scroll container added |
| `web/app/components/DayTimePrefs.tsx` | day rows fluid |
| `web/app/(app)/page.tsx` | body grid stacks |
| `web/app/globals.css` | orphaned tokens removed |
| `web/components/ui/tooltip.tsx` | deleted — installed in 3b, never used |
| `web/components/ui/collapsible.tsx` | created, Task 4 |

No other files. `TimetableGrid.tsx` is untouched throughout.

---

### Task 1: Settle the four scale inconsistencies

**Files:**
- Modify: `web/app/components/CoursePicker.tsx`, `web/app/components/CompareSection.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: the single recipe for each role that Tasks 3–7 follow.

Stage 3b's review found four places where the same semantic role got different classes across six implementers. Fixing them now stops this stage's responsive work from copying whichever variant it happens to land next to.

- [ ] **Step 1: One error-panel recipe**

Two exist. `PreferencesPanel.tsx:247` and `login/page.tsx:140` both use a bordered `text-sm` panel; `CoursePicker.tsx:266` uses a borderless `text-xs` one. Two against one, and the bordered form reads as a panel rather than tinted text, so it wins.

`CoursePicker.tsx:266` becomes:

```tsx
        <div className="mt-6 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
```

Read the current line before replacing it and keep whatever it renders inside unchanged.

- [ ] **Step 2: One empty-state recipe**

Four placeholder states sit in the same scroll container in `CoursePicker.tsx`, in two shapes. `:280`, `:507` and `:512` use `flex items-center justify-center p-6`; `:499` and `:504` use a left-aligned `p-3`. Three against two, and `CompareSection.tsx:157` uses the centred form too, so centred is the convention.

Bring both outliers into line:

```tsx
              <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
                Index not loaded yet.
              </div>
```

```tsx
            <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">Loading course index...</div>
```

Keep the copy exactly as it reads today, including the ellipsis style.

- [ ] **Step 3: One group-label convention**

`CoursePicker.tsx:277` ("Selected") puts its spacing as `mt-2` on the *following* sibling; `:479` ("Search and add courses") puts `mb-2` on the *label*. `PreferencesPanel`'s seven sub-headings all use `mb-2` on the label. The label-carries-its-own-spacing form wins — it is the majority and it keeps the spacing with the thing it describes.

Move the spacing onto the "Selected" label and remove it from the sibling:

```tsx
            <div className="mb-2 text-sm text-muted-foreground">Selected</div>
```

Then find the sibling that currently carries `mt-2` and drop that class from it — leave every other class on that element alone.

- [ ] **Step 4: Compare joins the heading outline**

`CoursePicker`, `PreferencesPanel` and `ResultsList` all title their sections with `<h2 className="text-lg font-semibold">`. `CompareSection.tsx:46` uses `<CardTitle>`, which renders a `<div>` — so "Compare Timetables" is absent from the document outline a screen-reader user navigates by.

Replace it with the same `<h2>` the other three use, keeping it inside `CardHeader`:

```tsx
          <h2 className="text-lg font-semibold">Compare Timetables</h2>
```

Remove the `CardTitle` import if nothing else in the file uses it.

- [ ] **Step 5: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 6: Confirm one recipe each**

```bash
cd web && echo "-- error panels --" && grep -rn "danger-bg" app --include="*.tsx"
echo "-- empty states --" && grep -rn "text-sm text-muted-foreground" app/components/CoursePicker.tsx
echo "-- section headings --" && grep -rn "text-lg font-semibold" app --include="*.tsx"
```

Every error panel should now carry `border border-[var(--danger-border)]` and `text-sm`. Every empty state in `CoursePicker` should be centred with `p-6`. Four `<h2 className="text-lg font-semibold">` should exist. Report the output.

- [ ] **Step 7: Look at it**

Preview route, both themes. Confirm the CoursePicker error panel now matches the preferences one, that all four empty states in the course list look alike, and that the Compare heading is visually unchanged despite becoming an `h2`.

- [ ] **Step 8: Commit**

```bash
git add web/app/components/CoursePicker.tsx web/app/components/CompareSection.tsx
git commit -m "refactor(web): one recipe per role, not six implementers' worth

Stage 3b's review found the same semantic role getting different classes
across the files six implementers restyled: two error-panel recipes, two
empty-state recipes inside one list, and two group-label conventions. Each
is settled here by majority, before this stage's responsive work copies
whichever variant it lands next to.

Compare's heading becomes an h2 like its three peers - CardTitle renders a
div, so the section was missing from the heading outline."
```

---

### Task 2: Correct the spacing that does not render what it says

**Files:**
- Modify: `web/app/components/PreferencesPanel.tsx`, `web/app/components/CompareSection.tsx`, `web/app/components/ResultsList.tsx`, `web/app/globals.css`
- Delete: `web/components/ui/tooltip.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

Three cleanups the 3b review identified, all small, all better done before the responsive work moves this code around.

- [ ] **Step 1: The margin that renders 40px**

`Card` is `flex flex-col gap-(--card-spacing)`, and **flex gaps add to margins rather than collapsing**. `PreferencesPanel.tsx:247`'s conflict-error panel carries `mt-6` as a flex child of a Card whose gap is 16px, so it renders **40px**, not the 24px commit `3e54ec5` was written to produce.

The Card's own 16px gap is the separation. Drop the margin:

```tsx
        <div className="whitespace-pre-wrap rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
```

That also makes it match `login/page.tsx:140`, which has no margin and renders at its parent's `gap-4` — the two error panels then agree in spacing as well as appearance.

Check `CoursePicker.tsx:266` the same way after Task 1 touched it: if that panel is also a flex child of a Card, its `mt-6` has the same problem and should go too. Look at its parent before deciding, and say what you found.

- [ ] **Step 2: Compare's Card gets the same padding as its peers**

`CompareSection.tsx:44`'s Card has no padding class, so it falls through to the primitive's 16px default. Its two peers — `page.tsx:316` and `PreferencesPanel.tsx:40` — are both `p-5`. The commit that created it was about making Compare a *peer* section, and it landed at a different padding from every peer.

```tsx
      <Card className="p-5">
```

Read the current line first; keep any other classes it carries.

- [ ] **Step 3: Remove the inert wrapper**

`ResultsList.tsx:37` wraps a single child in `flex items-center justify-between gap-2`. With one child, `justify-between` and `gap-2` do nothing. Delete the wrapper and promote its child, keeping the child's own classes.

- [ ] **Step 4: Delete the unused Tooltip**

`web/components/ui/tooltip.tsx` was installed in stage 3b and has no importer anywhere. Confirm, then delete:

```bash
cd web && grep -rn "components/ui/tooltip\|from \"@/components/ui/tooltip\"" app components --include="*.tsx" || echo "  no importers - safe to delete"
git rm web/components/ui/tooltip.tsx
```

If the grep finds an importer, stop and report — do not delete a file something uses.

- [ ] **Step 5: Remove the orphaned tokens**

`globals.css`'s own header says each legacy alias "is deleted as its consumers migrate". Several now have none. Confirm each before removing it:

```bash
cd web && for t in warn-bg warn-text danger-chip-bg text-body text-strong text-subtle text-faint shadow-lg overlay; do
  n=$(grep -rn "var(--$t)" app components --include='*.tsx' | wc -l | tr -d ' ')
  echo "  --$t: $n consumers"
done
```

Remove only tokens reporting `0`, from both `:root` and `.dark`. **`--danger-chip-bg` now has a consumer** — stage 3b's badge fix adopted it — so expect a non-zero count there and leave it. Leave `--overlay` regardless; it is documented as reserved.

Removing a token with a live consumer makes a colour vanish silently, so trust the count, not the list.

- [ ] **Step 6: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 7: Confirm every token still resolves**

```bash
cd web && comm -23 \
  <(grep -rhoE "var\(--[a-z0-9-]+" app components --include="*.tsx" | sed 's/var(//' | sort -u) \
  <(grep -oE "^[[:space:]]*--[a-z0-9-]+[[:space:]]*:" app/globals.css | sed 's/[[:space:]]//g; s/:$//' | sort -u)
```

Expected: no output. Anything printed has lost its definition.

- [ ] **Step 8: Look at it**

Preview route, both themes. Confirm the conflict error still sits sensibly below the weights row now that its margin is gone, and that Compare's padding matches the other two cards.

- [ ] **Step 9: Commit**

```bash
git add web/app/components/PreferencesPanel.tsx web/app/components/CompareSection.tsx web/app/components/ResultsList.tsx web/app/globals.css web/components/ui/tooltip.tsx
git commit -m "fix(web): correct spacing that did not render what it claimed

Card is flex flex-col gap-(--card-spacing), and flex gaps add to margins
rather than collapsing - so the conflict panel's mt-6 rendered 40px, not
the 24px the commit that added it was written to produce. The Card's own
gap is the separation; the margin goes.

Compare's Card gains the p-5 both its peers have, an inert
justify-between wrapper goes, the Tooltip installed in 3b and never used
goes, and the legacy aliases with no consumers left go with them."
```

---

### Task 3: Stack the page body

**Files:**
- Modify: `web/app/(app)/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: the breakpoint convention Tasks 4–7 follow.

The first responsive change and the one that establishes the pattern: `grid-cols-1` unprefixed, `lg:grid-cols-2` above 1024px.

- [ ] **Step 1: Stack the two-column body**

`page.tsx:315` is `<div className="mt-6 grid grid-cols-2 gap-4">`. It becomes:

```tsx
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
```

Mobile-first: the unprefixed class is the narrow case and `lg:` overrides it upward. Writing `grid-cols-2 lg:grid-cols-1` would be backwards.

- [ ] **Step 2: Let the container breathe less on a phone**

`page.tsx:307`'s `px-6` is 24px each side, which on a 375px screen leaves 327px of content. Reduce it at the narrow end only:

```tsx
    <div className="mx-auto w-full max-w-6xl px-4 py-5 lg:px-6">
```

This is the one place a narrower step is warranted, and it is a breakpoint-scoped override rather than a new scale value — `px-4` and `px-6` are both existing steps.

- [ ] **Step 3: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 4: Check both widths**

Preview route. At **1280 × 800** the layout must be indistinguishable from before this task — two columns, 24px gutters. At **375 × 812** the two columns must stack into one, with 16px gutters.

Critically: **confirm the page itself does not scroll horizontally at 375px.**

```js
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

Expected `true`. Report the two numbers. If it is `false`, something inside is wider than the viewport — find it and say what, rather than adding `overflow-x-hidden` to hide it.

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/page.tsx"
git commit -m "feat(web): stack the page body below lg

Mobile-first: grid-cols-1 unprefixed, lg:grid-cols-2 from 1024px, so the
narrow case is the default rather than an override. Container gutters drop
to px-4 below lg, where 24px each side costs too much of a 375px screen."
```

---

### Task 4: Stack and collapse the preference boxes

**Files:**
- Create: `web/components/ui/collapsible.tsx`
- Modify: `web/app/components/PreferencesPanel.tsx`

**Interfaces:**
- Consumes: the breakpoint convention from Task 3.
- Produces: `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` from `@/components/ui/collapsible`.

Two problems at 375px. The hard and soft boxes sit in their own `grid-cols-2`, which needs the same treatment as the page body. And once stacked, the panel is roughly thirty controls in a single column — the reason the spec asked for these to collapse.

- [ ] **Step 1: Install Collapsible**

```bash
cd web && md5 -q app/globals.css
cd web && npx shadcn@latest add collapsible --yes --overwrite
cd web && md5 -q app/globals.css && git diff --stat app/globals.css
```

It wraps `@base-ui/react/collapsible` and needs no new dependency. If the stylesheet hash moved, inspect the diff and revert any token change with `git checkout -- app/globals.css` — stage 1 established that the CLI rewrites tokens it recognises.

Exports: `Collapsible` (Root), `CollapsibleTrigger` (Trigger), `CollapsibleContent` (Panel).

- [ ] **Step 2: Stack the two boxes**

`PreferencesPanel.tsx:43` is `<div className="grid grid-cols-2 gap-4">`. It becomes:

```tsx
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
```

- [ ] **Step 3: Make each box collapsible below lg**

Both boxes should be open on desktop and collapsed on a phone, without two rendering paths to maintain. `Collapsible` takes `defaultOpen`, so drive it from a matchMedia check made after mount:

```tsx
  // Open on desktop, collapsed on a phone: below lg the panel is ~30 controls
  // in one column. Read after mount rather than during render - the server
  // has no viewport, and branching on one would be a hydration mismatch.
  const [openByDefault, setOpenByDefault] = useState(true);
  useEffect(() => {
    setOpenByDefault(window.matchMedia("(min-width: 1024px)").matches);
  }, []);
```

Then wrap each box's contents:

```tsx
        <Collapsible defaultOpen={openByDefault} key={`hard-${openByDefault}`}>
          <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
            <CardTitle className="text-sm font-semibold">Hard preferences</CardTitle>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {/* the box's existing contents, unchanged */}
          </CollapsibleContent>
        </Collapsible>
```

**Keep `CardTitle` at `text-sm font-semibold`.** These two are sub-headings inside the Preferences section, not section headings — the section's own `<h2>` is at `PreferencesPanel.tsx:41`. Promoting them to `text-lg` would be a visual change this stage must not make, and would add two more `<h2>`s to a document outline Task 1 just settled at four.

The `key` is load-bearing: `defaultOpen` is only read on mount, so without remounting when `openByDefault` flips, the effect would set the state and nothing would change. Say in your report that you understand why it is there.

Keep the info `Dialog` trigger where it is in the header — it must stay clickable without toggling the collapse, so if it sits inside `CollapsibleTrigger` it needs its own `e.stopPropagation()`. Check which it is and report what you did.

Repeat for the soft box. **The six `idPrefix` values must not change.**

- [ ] **Step 4: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 5: Check both widths and the console**

At **1280 × 800**: both boxes open, side by side, indistinguishable from before. At **375 × 812**: stacked and collapsed, each expanding on click.

Then, in both cases:

1. Clicking a day **letter** still toggles its checkbox — the `idPrefix` pairing.
2. Both info dialogs still open, and opening one does **not** toggle the collapse.
3. **No hydration mismatch in the console.** The `useEffect` pattern exists to avoid one; if a warning appears, the pattern is wrong and you should report it rather than suppressing it.

- [ ] **Step 6: Commit**

```bash
git add web/components/ui/collapsible.tsx web/app/components/PreferencesPanel.tsx
git commit -m "feat(web): stack and collapse the preference boxes below lg

Stacked, the panel is about thirty controls in one column. Each box now
collapses below lg and stays open above it.

defaultOpen is read after mount via matchMedia rather than during render,
because the server has no viewport and branching on one is a hydration
mismatch; the key forces the remount that makes the flip take effect."
```

---

### Task 5: Let the timetable grid scroll

**Files:**
- Modify: `web/app/components/ResultsList.tsx`, `web/app/components/CompareSection.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

The grid is `80px repeat(5, 1fr)`. At 375px that gives each day about 59px, which truncates course codes. Per the design decision, it keeps its desktop proportions and scrolls horizontally instead — and stage 4 keeps ownership of the component.

**This is done entirely from outside `TimetableGrid.tsx`.** Its root already has `overflow: hidden`, so a scroll container must sit above it, and a minimum width must be imposed on a wrapper the grid fills:

```tsx
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <TimetableGrid meetings={meetings} startHour={8} endHour={20} />
          </div>
        </div>
```

720px = the 80px gutter plus five 128px day columns, which is where course codes stop truncating. The inner wrapper forces that width; the outer scrolls.

- [ ] **Step 1: Wrap the results grid**

Find the `<TimetableGrid …/>` call in `ResultsList.tsx` and wrap it exactly as above, keeping its existing props.

- [ ] **Step 2: Wrap the compare overlay**

`CompareSection.tsx` renders `<CompareTimetableGrid …/>`. Wrap it the same way, keeping its props.

- [ ] **Step 3: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 4: Confirm `TimetableGrid.tsx` was not touched**

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer
git diff --stat master...HEAD -- web/app/components/TimetableGrid.tsx
```

Expected: no output. That file belongs to stage 4.

- [ ] **Step 5: Check the scroll, both widths**

API running, add a course and optimize so a grid renders.

At **1280 × 800**: the grid looks exactly as it did — 720px is well under the available width, so nothing changes.

At **375 × 812**:

1. The grid scrolls horizontally **inside its own container**.
2. **The page body does not scroll horizontally** — `document.documentElement.scrollWidth <= clientWidth` is still `true`. Report both numbers.
3. Course codes in the blocks are readable rather than truncated.
4. Pin two options and confirm the compare overlay scrolls the same way.

- [ ] **Step 6: Commit**

```bash
git add web/app/components/ResultsList.tsx web/app/components/CompareSection.tsx
git commit -m "feat(web): scroll the timetable grid horizontally on narrow screens

Five day columns plus an 80px gutter give about 59px per day at 375px,
which truncates course codes. The grid keeps its proportions inside a
scroll container instead.

Done from outside TimetableGrid.tsx, which stage 4 owns: its root is
already overflow:hidden, so the container sits above it and an inner
min-w-[720px] wrapper gives it a width to fill."
```

---

### Task 6: Make the fixed control widths fluid

**Files:**
- Modify: `web/app/components/PreferencesPanel.tsx`, `web/app/components/CompareSection.tsx`, `web/app/components/DayTimePrefs.tsx`, `web/app/components/CoursePicker.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

Several controls carry fixed widths that fit a half-width column but overflow a 375px one.

- [ ] **Step 1: The weights row**

`PreferencesPanel.tsx:184,198,212` give each label `w-36` (144px) and `:189,203` give the selects `w-28` (112px), with `:222` at `w-56` (224px). At 375px minus padding, 144 + 224 does not fit.

Let the label keep its width above the breakpoint and go fluid below, and let the selects fill what remains:

```tsx
              <div className="flex flex-col gap-1 text-sm text-foreground lg:flex-row lg:items-center lg:gap-2">
                <span className="lg:w-36">Gap penalty:</span>
                <Select …>
                  <SelectTrigger size="sm" className="w-full lg:w-28"><SelectValue /></SelectTrigger>
```

Apply the same shape to all three rows, using `lg:w-56` for the gap-shape select. Read each row before rewriting it and keep its `Select` wiring untouched.

- [ ] **Step 2: The compare selects**

`CompareSection.tsx:103,129` give both A/B triggers `w-48` (192px). Make them fill:

```tsx
                <SelectTrigger id="compare-a" size="sm" className="w-full lg:w-48"><SelectValue /></SelectTrigger>
```

And `:66`'s rename `Input` is `w-36` inside a chip; give it `w-full lg:w-36` so a long pin name is not clipped on a phone.

- [ ] **Step 3: The day rows**

`DayTimePrefs.tsx:82` gives the day label `w-12` and `:97` gives the time select `w-28`. Those fit at 375px, but the select should take the remaining space rather than leaving a gap:

```tsx
            <SelectTrigger size="sm" className="w-full lg:w-28">
```

Leave `w-12` on the day label — it is what keeps the five rows aligned.

- [ ] **Step 4: The course search row**

Check `CoursePicker.tsx`'s search wrapper and the selected-course chips for any fixed width that overflows at 375px. If the chips carry a `minWidth`-equivalent class, make it fluid the same way. Report what you found and changed; if nothing needed changing, say so.

- [ ] **Step 5: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 6: Check both widths**

At **1280 × 800**: every control the same width it was — this task must be invisible on desktop.

At **375 × 812**: no control overflows its container, and the page still does not scroll horizontally. Check the weights row, both compare selects, the day rows and the course chips. Report the horizontal-scroll check again.

- [ ] **Step 7: Commit**

```bash
git add web/app/components/PreferencesPanel.tsx web/app/components/CompareSection.tsx web/app/components/DayTimePrefs.tsx web/app/components/CoursePicker.tsx
git commit -m "feat(web): make the fixed control widths fluid below lg

The weights row's 144px labels and 224px select, the 192px compare
selects and the 112px time selects fit a half-width column and overflow a
375px one. Each keeps its width above lg and fills its container below."
```

---

### Task 7: Tap targets

**Files:**
- Modify: `web/app/components/ResultCard.tsx`, `web/app/components/CompareSection.tsx`, `web/app/components/CoursePicker.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

The login page's three controls were raised to `h-11` (44px) in `ec4c70d` after a reviewer flagged the `h-8` default as too small for a phone. The same argument applies to the controls a student taps most on the results screen.

- [ ] **Step 1: Audit what is actually small**

```bash
cd web && grep -rn 'size="sm"\|size="icon"\|h-7\|h-8' app --include="*.tsx" | grep -v components/ui/
```

For each hit, decide whether it is a **tap target** (Pin, unpin, remove, Add) or a **display control** whose size does not matter for touch. Report the list with your classification before changing anything — this task is easy to over-apply, and making every `size="sm"` control 44px would wreck the density of the preference panel.

- [ ] **Step 2: Raise the genuine tap targets below lg**

For each control you classified as a tap target, add a narrow-screen minimum while leaving desktop alone:

```tsx
          className="min-h-11 lg:min-h-0"
```

`min-h-11` rather than `h-11` so it raises the floor without fighting a control that is already taller. Apply it to the Pin button in `ResultCard`, the unpin button in `CompareSection`, and the Add and Remove buttons in `CoursePicker`.

Do **not** apply it to the day checkboxes: they sit in a five-column grid where 44px rows would double the panel's height, and their `Label` already extends the clickable area beyond the box.

- [ ] **Step 3: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 4: Measure**

At **375 × 812**, measure each control you changed with `getBoundingClientRect().height` and report the numbers. Each should be ≥ 44.

At **1280 × 800**, measure the same controls and confirm they are unchanged from before this task.

- [ ] **Step 5: Commit**

```bash
git add web/app/components/ResultCard.tsx web/app/components/CompareSection.tsx web/app/components/CoursePicker.tsx
git commit -m "feat(web): raise tap targets to 44px below lg

The same argument that raised the login controls in ec4c70d: Pin, unpin,
Add and Remove are what a student taps on a phone, and h-8 is 32px.
min-h-11 rather than h-11 so it raises a floor without fighting a taller
control, and lg:min-h-0 so desktop density is untouched.

Deliberately not applied to the day checkboxes - 44px rows would double
the preference panel's height, and their Label already extends the
clickable area."
```

---

### Task 8: Verify the stage

**Files:**
- Modify: none expected. If a step requires a change, make it and say so.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Confirm the inline-style count is unchanged**

```bash
cd web && grep -rc "style={{" app components --include="*.tsx" | grep -v ":0$" | grep -v "components/ui/" | sort -t: -k2 -rn
```

Expected exactly: `TimetableGrid.tsx:26`, `CompareSection.tsx:2`, `ResultCard.tsx:1`. This stage adds none. Watch for iCloud `" 2.tsx"` twins inflating the list.

- [ ] **Step 2: Confirm `TimetableGrid.tsx` is untouched**

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer
git diff --stat master...HEAD -- web/app/components/TimetableGrid.tsx
```

Expected: no output.

- [ ] **Step 3: Confirm no colour literals and no unlayered colour rules**

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer
git diff master...HEAD -- web/app web/components | grep "^+" | grep -oE '#[0-9a-fA-F]{3,8}\b|"white"|"crimson"' | sort -u || echo "  no colour literals"
cd web && grep -n "^[a-z]" app/globals.css
```

For the second: `body` is expected and safe — it sets the page ground and no component renders as `body`. Anything else setting a colour outside `@layer base` is stage 2a's Critical returning.

- [ ] **Step 4: Confirm every token still resolves**

```bash
cd web && comm -23 \
  <(grep -rhoE "var\(--[a-z0-9-]+" app components --include="*.tsx" | sed 's/var(//' | sort -u) \
  <(grep -oE "^[[:space:]]*--[a-z0-9-]+[[:space:]]*:" app/globals.css | sed 's/[[:space:]]//g; s/:$//' | sort -u)
```

Expected: no output. Task 2 removed tokens, so this is the check that none of them was still in use.

- [ ] **Step 5: Full gate**

```bash
cd api && .venv/bin/pytest tests/ -q
cd ../web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: 74 Python, 42 vitest, clean, eslint at its two pre-existing problems.

- [ ] **Step 6: Confirm the payload is untouched**

This stage restyles and must not change what the optimiser is asked for. Drive: term default `2610`, add `MATH 1003`, hard "Must be free" Mo, hard "No classes after" Tu at 12:00, Gap shape "Prefer one long gap", uncheck "Prefer at least one free weekday". Expected body:

```json
{"term":"2610","course_codes":["MATH 1003"],"max_solutions":6,"search_limit":2000,
 "prefs":{"prefer_one_free_day":false,"gap_shape":"consolidated","hard_free_days":["Mo"],
 "hard_no_after":{"Tu":"12:00"},"hard_no_before":{},"soft_free_days":[],"soft_no_after":{},
 "soft_no_before":{},"weights":{"gaps_per_min":0.1,"late_after_per_min":0.5,"early_before_per_min":0.5}},
 "instructor_locks":{},"section_locks":{}}
```

Quote what you captured. Any difference is a defect in this stage.

- [ ] **Step 7: The desktop must be unchanged**

At **1280 × 800**, both themes, walk the whole flow: add two courses, pin a lecture, set a hard free day and a cutoff, optimize, read the score bars, select cards, pin two, rename one, compare, unpin, open both explainer dialogs and the help dialog.

This stage is about the narrow case. **If anything looks different at 1280px, that is a regression** — report it rather than accepting it.

- [ ] **Step 8: The phone pass**

At **375 × 812**, both themes, the same flow. Report each of:

1. The page never scrolls horizontally — `document.documentElement.scrollWidth <= clientWidth` at every step.
2. Both preference boxes are collapsed and expand on tap.
3. The timetable scrolls inside its own container, and course codes are readable.
4. No control overflows its container.
5. Pin, unpin, Add and Remove all measure ≥ 44px.
6. Clicking a day letter toggles its checkbox.
7. Console shows no errors, no warnings, **no hydration mismatch** — Task 4's `matchMedia` pattern is the one at risk. A warning naming `fdprocessedid` is a browser form-scanner extension, not the app.

- [ ] **Step 9: Clean up**

```bash
cd web && rm -rf app/preview-tmp .next/types .playwright-mcp && cd .. && git checkout -- web/proxy.ts; git status --short; ls -la web/proxy.ts
```

Expected: clean apart from the repo's pre-existing untracked `kite-export.mp4`, and `proxy.ts` present.

- [ ] **Step 10: Commit**

Only if a step required a change. Otherwise report that no commit was needed — a verification task with an empty diff is a success, not a gap.

---

## Notes for the implementer

- **Mobile-first, always.** `grid-cols-1 lg:grid-cols-2`, not `grid-cols-2 lg:grid-cols-1`. The unprefixed class is the narrow case; `lg:` overrides it upward. Getting this backwards is the most common way to break a Tailwind layout and it looks correct on the machine you are testing on.
- **The desktop layout is a regression surface.** Every task must leave 1280px looking exactly as it did. If a change is visible there, it is wrong even if it looks better.
- **Flex gaps add to margins.** `Card` is `flex flex-col gap-(--card-spacing)`, so a `mt-6` on a Card child renders 40px, not 24px. Task 2 corrects two commits that got this wrong. Before adding a margin inside a Card, check whether the Card's gap already provides the separation.
- **Never edit `web/proxy.ts`** — delete it for the preview route and restore it with `git checkout --`. An agent in stage 3b edited it to bypass the auth gate and was killed before restoring it.
- **`next dev` never exits.** Background it in every task that needs a browser.
- **Delete `web/.next/types` after removing the preview route** — a stale `validator.ts` makes `tsc` fail with `TS2307` and looks like a real type error.
- The timetable grid's internals are stage 4. This stage gets its scrolling entirely from outside the file.
