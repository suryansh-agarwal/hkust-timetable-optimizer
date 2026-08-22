# Stage 5 — Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the carried findings that are defects rather than preferences, and remove the duplication that made four separate stage-4 tasks edit the same block twice each.

**Architecture:** Six independent changes across three files. The one structural change — extracting the block closure both grids duplicate — lands first and alone, so every later item that touches a block edits one copy. The rest are small, and each is small in a different file.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 (CSS-first `@theme inline`), shadcn/ui `base-nova` over `@base-ui/react`, Vitest.

**Design spec:** `docs/superpowers/specs/2026-08-22-stage5-cleanup-design.md`

**Branch:** all tasks land on `feature/stage5-cleanup`, cut from `master`. Create it before Task 1:

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer && git checkout -b feature/stage5-cleanup
```

## Global Constraints

Every task's requirements implicitly include this section.

- **No hex or named colour literals.** The `black` keyword inside `color-mix` is the sole exception, and only in the existing block ink recipe.
- **Never add a colour rule outside a cascade layer** in `globals.css`.
- **Contrast is a gate** — WCAG AA, 4.5:1 for text, 3:1 for UI. No task here changes a text colour; if one ends up doing so, measure it.
- **The grid stays custom.** Lane packing, clipping and absolute positioning must behave identically.
- **Subject-to-hue assignment must not change.** `subjectColors` sorts distinct subjects with `localeCompare` and indexes `SUBJECT_COLORS` modulo 8.
- **Inline styles in app code stand at five** and must stay five: the score bar's runtime width in `ResultCard.tsx`, the two compare swatch colours in `CompareSection.tsx`, and the two `minWidth: GRID_MIN_WIDTH_PX` wrappers in `ResultsList.tsx` and `CompareSection.tsx`. `TimetableGrid.tsx`'s twelve are runtime geometry and per-subject colour; Task 1 moves some of them but must not add any.
- **`web/proxy.ts` is the auth gate.** If a task deletes it to reach a preview route it must restore it with `git checkout -- web/proxy.ts` in the same task, and confirm it exists. Never edit it — a stage-4 agent added a route to its allowlist instead of deleting the file and that had to be reverted.
- Python backend untouched: `api/` stays at 74 passing tests.

## Two things every task should know about this codebase

- Use `./node_modules/.bin/tsc --noEmit`, not `npx tsc` — `npx` resolves to the wrong package here.
- A duplicate-identifier error inside `.next/types/` is an iCloud file-duplication artifact (`* 2.*` files), not a real error. `rm -rf .next` clears it. Do this after creating and removing any preview route.
- `npx eslint .` has two PRE-EXISTING problems that are not yours and must not be fixed here: `prefer-const` in `app/auth/callback/route.ts`, and `@next/next/no-img-element` in `app/login/page.tsx`. Your bar is no new ones.
- `next dev` never exits. Run it in the background, poll with `curl`, port **3000**. Kill any existing server first with `pkill -f "next dev"`.

## File Structure

| File | What changes |
|---|---|
| `web/app/components/TimetableGrid.tsx` | Task 1 extracts `GridBlock` from the two duplicated closures; Task 2 adds one class to it. |
| `web/app/components/PreferencesPanel.tsx` | Task 3 stops the mobile first-paint flash; Task 4 drops the height cap below `lg`. |
| `web/app/(app)/page.tsx` | Task 5 fixes two margins that do not render what they say, and one toast string. |

**No new files.** `GridBlock` stays inside `TimetableGrid.tsx` beside the chrome components stage 4 extracted; it has one consumer file and a second module would be indirection without a reader.

---

### Task 1: Extract the block closure both grids duplicate

**Files:**
- Modify: `web/app/components/TimetableGrid.tsx`

**Interfaces:**
- Consumes: `blockDetail`, `blockColors`, `DAY_LABELS`, `minutesToHHMM` — all already in the file.
- Produces: `<GridBlock>` and `LANE_GAP_PX`. Task 2 adds a class to `GridBlock`; nothing else in the stage touches this file.

`TimetableGrid` and `CompareTimetableGrid` render the same block markup twice. Stage 4 extracted the *chrome* around it and deliberately left this alone; four of its tasks then edited both copies in lockstep. Nothing drifted — its final review diffed the two closures and found every surviving difference behavioural — but that held because each task was reviewed against both copies. It is a property of how the reviews were run, not of the code.

Diffed against the current file, the two closures differ in exactly five things:

| | `TimetableGrid` | `CompareTimetableGrid` |
|---|---|---|
| `key` | `idx` | `` `${m.side}-${idx}` `` |
| label | no prefix | `` `Option ${m.side}, ` `` prefix |
| transition class | `transition-shadow` | `transition-[opacity,box-shadow] … ease-in-out` |
| handlers | none | `onMouseEnter/Leave/Focus/Blur` |
| style | — | `opacity`, `zIndex` |

Everything else is identical. `key` stays at the call site, where it belongs; the other four become props.

**This is a pure refactor. No rendered output may change.**

- [ ] **Step 1: Capture the baseline before touching anything**

Start the dev server in the background, create `web/app/preview-tmp/page.tsx` rendering both grids with a fixed meeting set that exercises lane overlap and at least one `code-only` block, and `rm web/proxy.ts` to reach it:

```tsx
"use client";
import { TimetableGrid, CompareTimetableGrid } from "../components/TimetableGrid";

const A = [
  { day: "Mo", start_min: 540, end_min: 620, course_code: "COMP 2011", section: "L1" },
  { day: "Mo", start_min: 600, end_min: 680, course_code: "MATH 1014", section: "T2" },
  { day: "We", start_min: 780, end_min: 800, course_code: "ECON 2103", section: "L2" },
  { day: "Fr", start_min: 480, end_min: 570, course_code: "LANG 1002", section: "L3" },
];
const B = [
  { day: "Tu", start_min: 540, end_min: 620, course_code: "COMP 2012", section: "L1" },
  { day: "We", start_min: 780, end_min: 860, course_code: "ECON 2103", section: "L1" },
];

export default function P() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <TimetableGrid meetings={A} />
      <CompareTimetableGrid meetingsA={A} meetingsB={B} />
    </div>
  );
}
```

Screenshot both grids at 1280px in light and dark. Keep the four files; Step 5 compares against them.

- [ ] **Step 2: Lift the lane gap**

Both closures declare `const gap = 6;` inside the map. Replace both with a module-level constant beside the other layout constants:

```tsx
/** Horizontal space between two overlapping classes in the same day column. */
const LANE_GAP_PX = 6;
```

- [ ] **Step 3: Write `GridBlock`**

Place it after `blockDetail` and before `TimetableGrid`. Copy every attribute and style value **verbatim** from the current closures — this task changes nothing about how a block looks.

```tsx
type GridBlockProps = {
  meeting: Meeting;
  colors: { bg: string; border: string; ink: string };
  label: string;
  top: number;
  height: number;
  leftPct: number;
  laneWidthPct: number;
  /** The two grids animate different properties: only the compare grid fades. */
  transitionClass: string;
  /** Compare grid only - dims the side that is not hovered or focused. */
  overlay?: { opacity: number; zIndex: number };
  /** Compare grid only - drives that dimming from pointer and keyboard alike. */
  interaction?: Pick<
    React.HTMLAttributes<HTMLDivElement>,
    "onMouseEnter" | "onMouseLeave" | "onFocus" | "onBlur"
  >;
};

function GridBlock({
  meeting: m, colors, label, top, height, leftPct, laneWidthPct,
  transitionClass, overlay, interaction,
}: GridBlockProps) {
  const detail = blockDetail(height);
  return (
    <div
      data-slot="grid-block"
      role="group"
      tabIndex={0}
      aria-label={label}
      title={label}
      className={cn(
        "shadow-[var(--elev-1)] hover:shadow-[var(--shadow-md)]",
        transitionClass,
        detail === "code-only" ? "px-1.5 py-px" : "p-1.5"
      )}
      {...interaction}
      style={{
        position: "absolute",
        top,
        height,
        left: `calc(${leftPct}% + ${LANE_GAP_PX / 2}px)`,
        width: `calc(${laneWidthPct}% - ${LANE_GAP_PX}px)`,
        borderRadius: 10,
        border: `2px solid ${colors.border}`,
        fontSize: 12,
        background: colors.bg,
        overflow: "hidden",
        ...overlay,
      }}
    >
      <div className="text-xs font-bold leading-tight" style={{ color: colors.ink }}>{m.course_code}</div>
      {detail !== "code-only" && (
        <div className="text-xs leading-tight" style={{ color: colors.ink }}>{m.section}</div>
      )}
      {detail === "full" && (
        <div className="mt-1 text-[11px] leading-tight" style={{ color: colors.ink }}>
          {minutesToHHMM(m.start_min)}–{minutesToHHMM(m.end_min)}
        </div>
      )}
    </div>
  );
}
```

Two details that matter:

- `duration-150` moves into each caller's `transitionClass` rather than the base, because the two strings already carry their own duration and splitting one across two places is how they drift.
- `...overlay` spreads last so the compare grid's `opacity` and `zIndex` land, and the main grid — which passes no `overlay` — is unchanged.

- [ ] **Step 4: Rewrite both call sites against it**

`TimetableGrid`:

```tsx
                return (
                  <GridBlock
                    key={idx}
                    meeting={m}
                    colors={colors}
                    label={label}
                    top={top}
                    height={height}
                    leftPct={leftPct}
                    laneWidthPct={laneWidthPct}
                    transitionClass="transition-shadow duration-150"
                  />
                );
```

`CompareTimetableGrid`:

```tsx
                return (
                  <GridBlock
                    key={`${m.side}-${idx}`}
                    meeting={m}
                    colors={colors}
                    label={label}
                    top={top}
                    height={height}
                    leftPct={leftPct}
                    laneWidthPct={laneWidthPct}
                    transitionClass="transition-[opacity,box-shadow] duration-150 ease-in-out"
                    overlay={{ opacity, zIndex: hoveredSide === m.side ? 10 : 1 }}
                    interaction={{
                      onMouseEnter: () => setHoveredSide(m.side),
                      onMouseLeave: () => setHoveredSide(null),
                      onFocus: () => setHoveredSide(m.side),
                      onBlur: () => setHoveredSide(null),
                    }}
                  />
                );
```

Each keeps its own `label` and `detail` derivation above the return — except `detail`, which `GridBlock` now computes from `height`, so delete both `const detail = blockDetail(height);` lines and their now-unused local.

- [ ] **Step 5: Prove the render did not change**

Re-screenshot at the same widths and themes and compare against Step 1 pixel-for-pixel. Any difference means the extraction changed something — find it rather than accepting it.

Then confirm the duplication is gone:

```bash
cd web && grep -c 'data-slot="grid-block"' app/components/TimetableGrid.tsx
```

Expected: **1**. If it is 2, the extraction did not land at both call sites.

- [ ] **Step 6: Tear down and verify**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts && ls proxy.ts
cd web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: `tsc` clean, 59 vitest, `next build` clean with `ƒ Proxy (Middleware)`, eslint at exactly its two pre-existing problems.

- [ ] **Step 7: Commit**

```bash
git add web/app/components/TimetableGrid.tsx
git commit -m "refactor(web): extract the block closure both grids duplicated

Stage 4 extracted the chrome and left this larger duplicate alone, then
four of its tasks edited both copies in lockstep. Nothing drifted, but
that held because each task was reviewed against both copies - a
property of the reviews, not of the code.

The two differed in five things: the key, an Option A/B label prefix, the
transition class, four hover and focus handlers, and opacity plus
zIndex. The key stays at the call site; the rest are props.

Pure refactor - screenshots before and after are identical in both
themes."
```

---

### Task 2: Stop the next lane painting over a focused block's ring

**Files:**
- Modify: `web/app/components/TimetableGrid.tsx`

**Interfaces:**
- Consumes: `GridBlock` from Task 1.
- Produces: nothing downstream.

The focus outline is 2px at 2px offset, so it extends 4px beyond the block. Lanes are separated by `LANE_GAP_PX` = 6px, which each block splits — 3px per side. So with two or more overlapping classes in a day, the outer ~1px of a focused block's ring is painted over by the block in the next lane.

The compare grid is already immune, by accident rather than design: `onFocus` sets `hoveredSide`, which sets `zIndex: 10`.

- [ ] **Step 1: Add the class**

In `GridBlock`'s `className`, add `focus-visible:z-10` to the base string:

```tsx
        "shadow-[var(--elev-1)] hover:shadow-[var(--shadow-md)] focus-visible:z-10",
```

One line, one place — which is what Task 1 bought. The compare grid sets `zIndex` inline, and an inline style beats a class, so its existing behaviour is unaffected.

- [ ] **Step 2: Prove it was broken and is now fixed**

Stand up the preview route from Task 1 Step 1 — its Monday column has two overlapping classes, which is the case that exhibits the bug.

Focus the *first* of the two overlapping blocks and compare its painted ring against the second block's left edge. Measure rather than eyeball:

```js
const bs = [...document.querySelectorAll('[data-slot="grid-block"]')];
const a = bs[0], b = bs[1];               // the two overlapping Monday blocks
a.focus();
({
  focusedRight: a.getBoundingClientRect().right,
  neighbourLeft: b.getBoundingClientRect().left,
  gap: b.getBoundingClientRect().left - a.getBoundingClientRect().right,
  ringExtends: 4,                          // 2px outline at 2px offset
  zIndexOnFocus: getComputedStyle(a).zIndex,
})
```

Expected after the fix: `zIndexOnFocus` is `10`. The `gap` should read about 6px, which is less than twice the 4px the ring extends — that is the arithmetic that makes the overlap real.

Screenshot the focused block at high zoom, before and after the change, and say in the report whether the clipped edge is visibly gone.

- [ ] **Step 3: Verify and commit**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts && ls proxy.ts
cd web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

```bash
git add web/app/components/TimetableGrid.tsx
git commit -m "fix(web): lift a focused block above its neighbouring lane

The focus outline extends 4px beyond the block and lanes are 6px apart,
3px per side, so with two overlapping classes in a day the outer edge of
a focused block's ring was painted over by the block beside it.

The compare grid was already immune by accident - focus sets hoveredSide,
which sets zIndex. This makes it deliberate, in the one place Task 1
left to change."
```

---

### Task 3: Stop the mobile first paint flashing both preference panels open

**Files:**
- Modify: `web/app/components/PreferencesPanel.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing downstream. Task 4 edits the same file but a different line.

`PreferencesPanel` renders `defaultOpen={true}` because the server has no viewport, paints, then a `useEffect` reads `matchMedia` and a `key` change remounts the Collapsible closed. On a phone that is roughly thirty controls appearing and vanishing on every load, plus the layout shift.

**The effect cannot move earlier.** Reading the viewport during render is a hydration mismatch; that is why it is in an effect, and the `eslint-disable` above it says so. `useSyncExternalStore` was considered and rejected — it would remove the disable but not the flash, because the server snapshot is still a fixed value.

So do not fix the effect. **Stop the paint.**

- [ ] **Step 1: Add the pre-hydration flag**

The existing effect already runs once on mount. Give it a second piece of state to clear, so the markup can be hidden below `lg` until the breakpoint is known:

```tsx
  const [openByDefault, setOpenByDefault] = useState(true);
  // True until the mount effect below runs. The server renders the panels open
  // because it has no viewport, so on a phone the first paint would show ~30
  // controls that the effect then collapses. While this is true the content is
  // hidden below lg, so that frame never reaches the screen. At lg and above
  // the class does not apply and the desktop render is untouched.
  const [beforeHydration, setBeforeHydration] = useState(true);
  useEffect(() => {
    // One-time sync with the browser's viewport on mount. This is the
    // documented exception to the rule below: reading it during render
    // would be a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenByDefault(window.matchMedia("(min-width: 1024px)").matches);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBeforeHydration(false);
  }, []);
```

- [ ] **Step 2: Hide the content below `lg` until that flag clears**

Both `CollapsibleContent`s — at roughly `:101` and `:185` — take the class. `CollapsibleContent` passes through to Base UI's `Panel`, which accepts `className`, so nothing new is introduced:

```tsx
            <CollapsibleContent className={beforeHydration ? "max-lg:hidden" : undefined}>
```

A ternary rather than `cn()`: there is no base class to merge, and `cn` is not currently imported in this file — adding an import for one conditional earns nothing.

- [ ] **Step 3: Prove no frame paints the content**

This is the hardest verification in the stage and a single screenshot cannot establish it — by the time you take one, hydration has finished and the panel is correctly collapsed either way.

Assert on the DOM across the hydration boundary instead. At 375px, on a **cold navigation** (not a hot reload, which skips SSR):

```js
// Immediately on document load, before React hydrates
const before = [...document.querySelectorAll('[data-slot="collapsible-content"]')]
  .map((el) => ({ cls: el.className, height: el.getBoundingClientRect().height }));
// then after a settle
await new Promise((r) => setTimeout(r, 800));
const after = [...document.querySelectorAll('[data-slot="collapsible-content"]')]
  .map((el) => ({ cls: el.className, height: el.getBoundingClientRect().height }));
({ before, after });
```

Expected: `before` shows the `max-lg:hidden` class with height 0; `after` shows it gone, still height 0 because the Collapsible is now genuinely closed. **A `before` height greater than 0 means the flash is still there.**

Also confirm at 1280px that `before` and `after` both show the panels open and non-zero — the fix must not collapse desktop.

- [ ] **Step 4: Confirm no hydration warning appeared**

The whole reason the effect exists is to avoid a mismatch. Read the console after a cold 375px load and confirm zero errors and zero warnings, specifically no hydration mismatch.

- [ ] **Step 5: Verify and commit**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts && ls proxy.ts
cd web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

```bash
git add web/app/components/PreferencesPanel.tsx
git commit -m "fix(web): stop the mobile first paint flashing the panels open

The server has no viewport, so it renders the panels open; the effect
that reads matchMedia runs after paint, so a phone showed ~30 controls
and then collapsed them, with the layout shift that follows.

The effect cannot move earlier - reading the viewport during render is
the hydration mismatch it exists to avoid - so the paint is what
changes. The content is hidden below lg until that effect clears a flag,
which means the frame never reaches the screen. Desktop is untouched:
the class does not apply at lg and above.

Costs one boolean and one class. useSyncExternalStore would drop the
eslint-disable but not the flash, because the server snapshot is still
a fixed value."
```

---

### Task 4: Stop the preferences panel scrolling on both axes

**Files:**
- Modify: `web/app/components/PreferencesPanel.tsx`

**Interfaces:**
- Consumes: nothing. Task 3 edited this file; this is a different line.
- Produces: nothing downstream.

The panel's root is `max-h-[520px] overflow-y-auto`. CSS computes the other axis to `auto` when one is not `visible`, so it scrolls horizontally too.

That matters past the panel itself: the page-level `document.scrollWidth === clientWidth` check three stage-3c tasks relied on cannot see anything overflowing inside it. Nothing overflows today — the widest mobile row measures about 223px — but the check is weaker than it was trusted to be.

Below `lg` the cap earns nothing anyway: stacking already made the panel full-width and roughly twice as tall, so a nested touch scroller inside the page scroller is the normal case rather than an edge one.

- [ ] **Step 1: Drop the cap below `lg`**

```tsx
    <Card className="max-h-none overflow-y-auto p-5 lg:max-h-[520px]">
```

`overflow-y-auto` stays: with no cap it has nothing to do below `lg`, and above `lg` it is what makes the cap work.

- [ ] **Step 2: Confirm both directions**

At **375px**:

```js
// Four or more cards render on this page - the panel root is the one whose
// own heading is "Preferences", not simply the first.
const p = [...document.querySelectorAll('[data-slot="card"]')]
  .find((el) => el.querySelector(":scope > h2")?.textContent === "Preferences");
({
  maxHeight: getComputedStyle(p).maxHeight,
  scrollsX: p.scrollWidth > p.clientWidth,
  scrollsY: p.scrollHeight > p.clientHeight,
  pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
})
```

Expected: `maxHeight: "none"`, `scrollsX: false`, `scrollsY: false`, `pageOverflows: false`.

At **1280px**: `maxHeight` is `520px` and the panel still scrolls vertically when its content exceeds that — the desktop behaviour must survive. Expand both preference boxes to make the content tall enough to test it.

- [ ] **Step 3: Verify and commit**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts && ls proxy.ts
cd web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

```bash
git add web/app/components/PreferencesPanel.tsx
git commit -m "fix(web): stop the preferences panel scrolling sideways on a phone

max-h with overflow-y makes CSS compute the other axis to auto, so the
panel was a scroll container in both directions. That also blinded the
page-level scrollWidth check three stage-3c tasks leaned on - it cannot
see overflow inside a nested scroller.

Below lg the cap earned nothing: stacking already made the panel
full-width and about twice as tall. It applies from lg up, where it
still does its job."
```

---

### Task 5: Two margins that do not render what they say, and one message that names the wrong cause

**Files:**
- Modify: `web/app/(app)/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing downstream.

Two unrelated fixes that happen to live in one file.

**The margins.** `page.tsx:317`'s `mb-3` and `:344`'s `mt-1` are both direct children of `<Card className="p-5">`, which is `flex flex-col gap-(--card-spacing)` with `--card-spacing` at 16px. Flex gaps **add** to margins rather than collapsing, so they render 28px and 20px, not 12px and 4px. `mb-3` is not a step on the scale at all.

This is the exact trap stage 3c's Task 2 existed to close; these two sat outside every task's declared file list and survived it. The Card's own 16px gap is the separation — the margins are additions nobody asked for.

**The message.** `page.tsx:286` fires `toast.error("Timetable not possible with current subjects")` when an optimise returns nothing. Since section locking shipped that is frequently untrue: the cause is often a pinned lecture or tutorial. The message sends a student to remove a course when the fix is to clear a pin.

- [ ] **Step 1: Remove both margins**

Line 317: `<div className="mb-3">` becomes `<div>`.
Line 344: `<p className="mt-1 text-sm">` becomes `<p className="text-sm">`.

The Card's flex gap already provides 16px between each child, which is the section rhythm the scale calls for.

- [ ] **Step 2: Correct the message**

```tsx
        toast.error("Timetable not possible with current subjects/sections");
```

Verbatim — the existing phrasing stands, and only the cause changes.

- [ ] **Step 3: Measure the margins rather than reading the classes**

The whole point of this fix is that the two disagreed. At 1280px:

```js
// Not simply the first card on the page - this is the one holding the term
// select and the course picker.
const card = [...document.querySelectorAll('[data-slot="card"]')]
  .find((el) => (el.textContent || "").trimStart().startsWith("Term"));
[...card.children].map((el) => ({
  tag: el.tagName,
  text: (el.textContent || "").trim().slice(0, 24),
  marginTop: getComputedStyle(el).marginTop,
  marginBottom: getComputedStyle(el).marginBottom,
  gapToNext: el.nextElementSibling
    ? Math.round(el.nextElementSibling.getBoundingClientRect().top - el.getBoundingClientRect().bottom)
    : null,
}))
```

Expected after the fix: every `marginTop`/`marginBottom` is `0px`, and `gapToNext` is a consistent **16px** between siblings. Before the fix the same probe reads 28px and 20px at those two seams — run it first so the report has both.

- [ ] **Step 4: Confirm the toast text at the point it fires**

The message only appears when an optimise returns zero results, which needs the backend. If you can run it, force that case — an impossible hard constraint will do — and read the toast. If you cannot, say so plainly and confirm the string by reading the source; do not claim to have seen it.

- [ ] **Step 5: Verify and commit**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts && ls proxy.ts
cd web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

```bash
git add "web/app/(app)/page.tsx"
git commit -m "fix(web): put two margins on the scale and name sections in the toast

mb-3 and mt-1 are flex children of a p-5 Card, and flex gaps add to
margins rather than collapsing, so they rendered 28px and 20px - not the
12px and 4px they name, and mb-3 is not on the scale at all. The Card's
own 16px gap is the separation; the margins were additions on top.

And an impossible timetable is often caused by a pinned lecture rather
than the subject list, so the toast named the wrong thing to change."
```

---

### Task 6: Verify the stage

**Files:** none — this task changes nothing unless it finds something.

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence the final review reads.

- [ ] **Step 1: Inline-style census**

```bash
cd web && grep -c 'style={{' app/components/TimetableGrid.tsx
grep -rn 'style={{' app/components/ResultCard.tsx app/components/CompareSection.tsx app/components/ResultsList.tsx "app/(app)/page.tsx"
```

Outside the grid, expect **exactly five**: the score bar's width, the two compare swatches, and the two `minWidth: GRID_MIN_WIDTH_PX` wrappers.

Inside the grid, expect **exactly eight**, down from twelve. Task 1 collapses two block wrappers into one and six `color: colors.ink` lines into three, and leaves the four chrome ones untouched:

| | |
|---|---|
| `TimeAxis` height, hour-label `top`/`left` | 2 |
| `DayColumn` height, hour-line position | 2 |
| the single block wrapper | 1 |
| the block's three `colors.ink` lines | 3 |

A different number means the extraction landed differently than planned — say which and why before accepting it.

- [ ] **Step 2: No colour literals**

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer
git diff master...HEAD -- web/ | grep "^+" | grep -oE '#[0-9a-fA-F]{3,8}\b|\b(white|black|crimson|red|blue|green)\b' | sort -u
```

Expected: nothing. No task in this stage touches the ink recipe, so even `black` should be absent.

- [ ] **Step 3: Every token resolves**

```bash
cd web && comm -23 \
  <(grep -rhoE "var\(--[a-z0-9-]+" app components --include="*.tsx" | sed 's/var(//' | sort -u) \
  <(grep -oE "^[[:space:]]*--[a-z0-9-]+[[:space:]]*:" app/globals.css | sed 's/[[:space:]]//g; s/:$//' | sort -u)
```

Expected: no output.

- [ ] **Step 4: Full gate**

```bash
cd api && .venv/bin/pytest tests/ -q
cd ../web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: 74 Python, 59 vitest, `tsc` clean, `next build` clean with `ƒ Proxy (Middleware)`, eslint at exactly its two pre-existing problems.

- [ ] **Step 5: Subject-to-hue mapping unchanged**

Task 1 moved the code that assigns colours. Render a fixed eight-subject timetable, read each block's computed background, and confirm it matches the fill computed from the token values — the check stage 4 used:

> composite `hsl(H S% L% / 0.16)` over `--card` and compare, per subject, in `localeCompare` order against `--sub-1` … `--sub-8`.

Expected: agreement within 1/255 on all eight.

- [ ] **Step 6: Both grids still render identically to `master`**

The stage's one structural change was a refactor that promised no visual difference, and three later tasks then edited around it. Screenshot both grids at 1280px in both themes against a `master` build and confirm they match.

- [ ] **Step 7: The four fixes, each demonstrated**

Restate the measured evidence from Tasks 2–5 in one place: the focused block's `z-index`, the pre- and post-hydration panel heights at 375px, the panel's `maxHeight` and both scroll flags at each width, and the Card's child gaps.

- [ ] **Step 8: Console clean at both widths**

375px and 1280px, both themes: zero errors, zero warnings, no hydration mismatch.

- [ ] **Step 9: Tear down**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts && ls proxy.ts && git status --short
```

`proxy.ts` present at 2874 bytes; nothing untracked but the repo's pre-existing `kite-export.mp4`.

- [ ] **Step 10: Report**

No commit unless a step found something. If one did, fix it in its own commit and say which step caught it.
