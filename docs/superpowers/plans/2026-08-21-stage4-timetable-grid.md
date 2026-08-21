# Stage 4 — Timetable Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `TimetableGrid.tsx` onto the design system the other eight surfaces already use — tokens, contrast, hover and focus, density — without changing what the grid *is*.

**Architecture:** The file holds two components, `TimetableGrid` and `CompareTimetableGrid`, that duplicate their entire chrome verbatim and differ only in where a block's colour comes from and whether hovering fades the other side. Task 1 extracts that shared chrome so every later change lands once instead of twice; the rest migrate tokens, fix four failing contrast ratios, give blocks real hover and focus states, and stop short blocks from clipping their own text.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 (CSS-first `@theme inline`), shadcn/ui `base-nova` over `@base-ui/react`, Vitest.

**Design spec:** `docs/superpowers/specs/2026-08-09-shadcn-redesign-design.md`

**Branch:** all tasks land on `feature/stage4-grid`, cut from `master`. Create it before Task 1:

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer && git checkout -b feature/stage4-grid
```

## Scope

This stage is **the grid only**. The seven Minor findings carried out of stage 3c are recorded at the end of the design spec under "Carried into stage 4"; exactly one of them belongs here — the duplicated `min-w-[720px]` literals, which are the grid's own geometry (Task 6). The other six are a later cleanup stage and must not be touched:

- `page.tsx`'s `mb-3` / `mt-1` add-trap
- the mobile first-paint flash in `PreferencesPanel`
- the nested scroll containers in `PreferencesPanel` / `CoursePicker`
- find-in-page not reaching collapsed panels
- the ~20 `size="sm"` select triggers at 28px
- the stale `px-6` row in the stage 3c plan's scale table

## The contrast problem, measured

Every block derives three colours from one hue (`TimetableGrid.tsx:44-49`):

```
bg     hsl(var(--sub-N) / 0.16)
border hsl(var(--sub-N) / 0.55)
text   hsl(var(--sub-N))
```

so the label sits on a 16% wash of *itself*. Measured against WCAG AA's 4.5:1 for normal text, with `--card` resolved exactly (`oklch(1 0 89.88)` → `rgb(255,255,255)` light, `oklch(0.2 0.035 259)` → `rgb(12,22,38)` dark):

| Light hue | Label on its own fill | | Dark |
|---|---|---|---|
| `--sub-8` | 3.02:1 | **fail** | 7.40:1 pass |
| `--sub-2` | 3.44:1 | **fail** | 7.46:1 pass |
| `--sub-5` | 3.63:1 | **fail** | 5.97:1 pass |
| `--sub-6` | 4.00:1 | **fail** | 6.71:1 pass |
| `--sub-1` | 4.68:1 | pass | 5.43:1 pass |
| `--sub-3` | 4.73:1 | pass | 5.26:1 pass |
| `--sub-4` | 4.92:1 | pass | 5.47:1 pass |
| `--sub-7` | 5.82:1 | pass | 4.92:1 pass |

**Dark mode needs no change.** Light mode fails on four.

**This supersedes the spec's wording.** `docs/superpowers/specs/2026-08-09-shadcn-redesign-design.md` says stage 4 retunes the subject hues in OKLCH. That was written before the ratios were measured, and retuning visibly shifts a palette whose only actual defect is four light-mode label ratios. The narrower fix below was chosen and approved instead: the eight `--sub-*` triplets keep their current HSL values. A reviewer should read the spec line as satisfied by this, not skipped.

**The decided fix — keep the palette, darken only the ink.** Fill and border keep today's exact values, so the grid's colours are unchanged. The label mixes the same hue toward black:

```css
color-mix(in oklab, hsl(var(--sub-N)), black var(--sub-ink-mix))
```

with `--sub-ink-mix: 16%` in `:root` and `0%` in `.dark`. `oklab`, not `oklch`: black has no hue, and mixing toward it in a polar space is undefined at the endpoint. At 16% all eight light hues land between **4.55:1 and 7.85:1**.

**The opacity hierarchy has to go.** The section line renders at `opacity: 0.85` and the time line at `0.75` (`:206-209`), compositing the ink back toward the fill. To hold 4.5:1 through those, the mix would have to reach **28%** and **40%** — which flattens the palette to near-black and defeats the decision above. `--muted-foreground` was tested as a substitute for the secondary lines and fails too, at 4.17–4.60:1 across the eight fills.

So all three lines use the same ink, and hierarchy is carried by **size and weight** — which is how every other surface has worked since stage 3b. This is the one visible change in this stage: the section and time lines stop being faded.

## Global Constraints

Every task's requirements implicitly include this section.

- **No hex or named colour literals.** The `black` keyword inside `color-mix` is the sole exception, and only in the ink recipe above.
- **Never add a colour rule outside a cascade layer.** Stage 2a shipped a Critical when an unlayered `button { color: … }` outranked Tailwind's `@layer utilities` — unlayered declarations beat layered ones regardless of specificity.
- **Contrast is a gate, not a preference.** 4.5:1 for text, 3:1 for UI. If a task changes a text or border colour, measure it and put the number in the report.
- **The grid stays custom.** No component library, no third-party scheduler. Lane packing, clipping and absolute positioning are the point of the file and their behaviour must not change.
- **Subject-to-hue assignment must not change.** `subjectColors` sorts the distinct subjects with `localeCompare` and indexes `SUBJECT_COLORS` modulo 8 (`:125-136`). The same timetable must produce the same colours before and after this stage.
- **`--overlay` and `--danger-chip-bg` stay defined** even though this stage does not use them.
- Python backend untouched: `api/` stays at 74 passing tests.
- The two `min-w-[720px]` literals are the grid's geometry and are Task 6's; do not adjust them earlier.

## File Structure

| File | Responsibility after this stage |
|---|---|
| `web/app/components/TimetableGrid.tsx` | The two exported components and the shared chrome they both render. Currently 369 lines with ~85% duplication between the two; Task 1 removes the duplication, so later tasks edit one place. |
| `web/app/globals.css` | Gains `--sub-ink-mix`; loses the five legacy aliases whose last consumer this file is. |
| `web/app/components/ResultsList.tsx`, `CompareSection.tsx` | The `min-w-[720px]` literals become a named constant sourced from the grid (Task 6). |

**No new files.** The shared chrome stays inside `TimetableGrid.tsx` as module-level components — it is only used there, and a second file would be indirection without a consumer.

---

### Task 1: Extract the chrome the two grids duplicate

**Files:**
- Modify: `web/app/components/TimetableGrid.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `GRID_START_HOUR`, `GRID_END_HOUR`, `HOUR_ROW_HEIGHT`, `useGridGeometry`, `<GridFrame>`, `<GridHeaderRow>`, `<TimeAxis>`, `<DayColumn>`. Tasks 2–6 edit these instead of two copies of the same markup.

`TimetableGrid` (`:85`) and `CompareTimetableGrid` (`:223`) render byte-identical chrome: the same outer bordered box, the same `80px repeat(5, 1fr)` header, the same time axis, the same hour lines. Migrating tokens twice is how the two drift apart, and verbatim duplication of a logic block is a defect the review rubric flags on sight. This task is a pure refactor: **no rendered output may change.**

- [ ] **Step 1: Capture the current render as the baseline**

The safety net for the whole task. Start the dev server in the **background** (`next dev` never exits):

```bash
cd web && npx next dev --port 3000
```

Create `web/app/preview-tmp/page.tsx` rendering both grids with a fixed meeting set, and `rm web/proxy.ts` to reach it (delete, never rename — `git checkout` is how it comes back):

```tsx
"use client";
import { TimetableGrid, CompareTimetableGrid } from "../components/TimetableGrid";

const A = [
  { day: "Mo", start_min: 540, end_min: 620, course_code: "COMP 2011", section: "L1" },
  { day: "Mo", start_min: 600, end_min: 680, course_code: "MATH 1014", section: "T2" },
  { day: "We", start_min: 780, end_min: 810, course_code: "ECON 2103", section: "L2" },
  { day: "Fr", start_min: 480, end_min: 570, course_code: "LANG 1002", section: "L3" },
];
const B = [
  { day: "Tu", start_min: 540, end_min: 620, course_code: "COMP 2012", section: "L1" },
  { day: "We", start_min: 780, end_min: 860, course_code: "ECON 2103", section: "L1" },
];

export default function PreviewTmp() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <TimetableGrid meetings={A} />
      <CompareTimetableGrid meetingsA={A} meetingsB={B} />
    </div>
  );
}
```

Screenshot both grids at 1280px in light and dark. Keep the four files; Step 5 compares against them.

- [ ] **Step 2: Lift the constants and the geometry hook**

Both components compute the same four values from `startHour`/`endHour`. Replace both copies with:

```tsx
const GRID_START_HOUR = 8;
const GRID_END_HOUR = 20;
const HOUR_ROW_HEIGHT = 64; // px per hour

function useGridGeometry(startHour = GRID_START_HOUR, endHour = GRID_END_HOUR) {
  const startMin = startHour * 60;
  const endMin = endHour * 60;
  const pxPerMin = HOUR_ROW_HEIGHT / 60;
  return { startHour, endHour, startMin, endMin, pxPerMin, gridHeight: (endMin - startMin) * pxPerMin };
}
```

- [ ] **Step 3: Extract the four chrome pieces**

Copy the markup across **verbatim** — same inline styles, same tokens, same values. Token migration is Task 2; mixing it in here means a refactor and a restyle land in one unreviewable diff.

```tsx
function GridFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      {children}
    </div>
  );
}

function GridHeaderRow() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `80px repeat(5, 1fr)`, background: "var(--surface-2)", borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{ padding: 10, fontWeight: 700, fontSize: 12, color: "var(--text-muted)" }}>Time</div>
      {DAYS.map((d) => (
        <div key={d.key} style={{ padding: 10, fontWeight: 700 }}>{d.label}</div>
      ))}
    </div>
  );
}

function TimeAxis({ startHour, endHour, startMin, pxPerMin, gridHeight }: ReturnType<typeof useGridGeometry>) {
  return (
    <div style={{ position: "relative", height: gridHeight, borderRight: "1px solid var(--border-subtle)" }}>
      {Array.from({ length: endHour - startHour + 1 }).map((_, i) => {
        const hour = startHour + i;
        const y = (hour * 60 - startMin) * pxPerMin;
        return (
          <div key={hour} style={{ position: "absolute", top: y - 8, left: 10, fontSize: 12, color: "var(--text-muted)" }}>
            {hour.toString().padStart(2, "0")}:00
          </div>
        );
      })}
    </div>
  );
}

function DayColumn({ dayKey, startHour, endHour, pxPerMin, gridHeight, children }: {
  dayKey: string;
  startHour: number;
  endHour: number;
  pxPerMin: number;
  gridHeight: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ position: "relative", height: gridHeight, borderRight: dayKey !== "Fr" ? "1px solid var(--border-subtle)" : undefined }}>
      {Array.from({ length: endHour - startHour }).map((_, i) => (
        <div key={i} style={{ position: "absolute", top: i * 60 * pxPerMin, left: 0, right: 0, height: 1, background: "var(--border-faint)" }} />
      ))}
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite both components against the extracted pieces**

Each keeps its own `byDay`, `packed`, colour selection and block markup — only the chrome comes from the shared pieces. `CompareTimetableGrid` keeps its `hoveredSide` state exactly as it is; Task 4 owns that.

- [ ] **Step 5: Prove the render did not change**

Re-screenshot at the same widths and themes and compare against Step 1. Any visible difference means the extraction changed something — find it rather than accepting it.

Also confirm the duplication is actually gone:

```bash
cd web && grep -c "repeat(5, 1fr)" app/components/TimetableGrid.tsx
```

Expected: `2` — one in `GridHeaderRow`, one in the body grid that both components share. If it is still 4, the extraction did not land.

- [ ] **Step 6: Tear down the scaffolding**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts && ls proxy.ts && git status --short
```

`proxy.ts` must exist. A missing proxy silently disables authentication.

- [ ] **Step 7: Verify**

```bash
cd web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: `tsc` clean, 42 vitest, `next build` clean with `ƒ Proxy (Middleware)` in the route list, and eslint reporting **exactly** the two pre-existing problems — `prefer-const` in `app/auth/callback/route.ts` and `@next/next/no-img-element` in `app/login/page.tsx`.

If `tsc` reports a duplicate-identifier error in `.next/types/`, look for iCloud duplicates: `find . -path ./node_modules -prune -o -name "* 2.*" -print`. They are build-cache artifacts; `rm -rf .next` clears them.

- [ ] **Step 8: Commit**

```bash
git add web/app/components/TimetableGrid.tsx
git commit -m "refactor(web): extract the chrome both timetable grids duplicated

The two components rendered byte-identical frames, header rows, time
axes and hour lines. Migrating that twice is how the two drift, so it
comes out first and the rest of the stage edits one copy.

Pure refactor - the markup moved verbatim, tokens and all. Screenshots
before and after are identical in both themes."
```

---

### Task 2: Move the chrome onto shadcn tokens

**Files:**
- Modify: `web/app/components/TimetableGrid.tsx`

**Interfaces:**
- Consumes: `GridFrame`, `GridHeaderRow`, `TimeAxis`, `DayColumn` from Task 1.
- Produces: chrome with zero legacy-alias references. Task 6 deletes the aliases themselves once Task 3 clears the last ones out of the blocks.

The chrome is the last place in the app still reading `--border-subtle`, `--border-faint`, `--surface-2`, `--shadow-sm` and `--text-muted`. All five are aliases defined in `globals.css` purely to keep inline styles alive during the migration; every other file stopped using them stages ago.

**The target is not zero inline styles.** Absolute positions, heights and lane widths are computed at runtime from the meeting data and belong in `style`. Everything static — colour, spacing, radius, type — becomes a `className`.

Apply exactly this mapping. Each target is the token the alias already resolves to, so **nothing should look different**:

| Current | Becomes | Why this target |
|---|---|---|
| `border: "1px solid var(--border)"` | `border border-border` | direct |
| `borderRadius: 12` | `rounded-xl` | `--radius-xl` is `calc(0.625rem * 1.4)` = 14px; use `rounded-[12px]` if the 2px shows against the screenshot |
| `overflow: "hidden"` | `overflow-hidden` | direct |
| `gridTemplateColumns: "80px repeat(5, 1fr)"` | `grid grid-cols-[80px_repeat(5,1fr)]` | direct |
| `background: "var(--surface-2)"` | `bg-muted` | `--surface-2` is defined as `var(--muted)` |
| `borderBottom: "1px solid var(--border-subtle)"` | `border-b border-border` | `--border-subtle` is defined as `var(--border)` |
| `borderRight: "1px solid var(--border-subtle)"` | `border-r border-border` | same |
| `background: "var(--border-faint)"` (hour lines) | `bg-border` | `--border-faint` is defined as `var(--border)` |
| `padding: 10` | `p-2.5` | 10px |
| `fontWeight: 700` | `font-bold` | direct |
| `fontSize: 12` | `text-xs` | direct |
| `color: "var(--text-muted)"` | `text-muted-foreground` | `--text-muted` is defined as `var(--muted-foreground)` |
| `boxShadow: "var(--shadow-sm)"` | `shadow-sm` | see the note below |

**On `--shadow-sm`.** The app defines `--shadow-sm` at `:root`, which collides with Tailwind v4's own theme variable of that name — a carry-over flagged back in stage 2 and never resolved. Switching to Tailwind's `shadow-sm` utility and letting Task 6 delete the custom property ends the collision. The two values are close (`0 1px 3px oklch(0 0 0 / 0.08)` against Tailwind's default) but not identical; confirm against the screenshot and say in the report whether any difference is visible.

- [ ] **Step 1: Re-establish the baseline**

Same scaffolding as Task 1 Step 1 — background dev server, `preview-tmp` route, `rm proxy.ts`, screenshots at 1280px in both themes. This task claims to be visually neutral, so it needs the same proof.

- [ ] **Step 2: Apply the mapping to the four chrome pieces**

Work through `GridFrame`, `GridHeaderRow`, `TimeAxis` and `DayColumn`. `TimeAxis` and `DayColumn` keep `position`, `top`, `height`, `left`, `right` in `style` — those are geometry. Do not mix a `style` colour with a `className` colour on the same element.

- [ ] **Step 3: Confirm the chrome is clean**

```bash
cd web && grep -n 'border-subtle\|border-faint\|surface-2\|shadow-sm\|text-muted' app/components/TimetableGrid.tsx
```

Expected: only hits inside the block markup, which Task 3 owns. Zero hits in the four chrome components. If a chrome hit survives, the mapping was applied incompletely.

- [ ] **Step 4: Compare against the baseline**

Re-screenshot and diff against Step 1. Report any visible difference and its cause. The radius and the shadow are the two plausible ones.

- [ ] **Step 5: Tear down and verify**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts && ls proxy.ts
cd web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Same expectations as Task 1 Step 7.

- [ ] **Step 6: Commit**

```bash
git add web/app/components/TimetableGrid.tsx
git commit -m "feat(web): move the grid chrome onto shadcn tokens

The frame, header row, time axis and hour lines were the last consumers
of --border-subtle, --border-faint, --surface-2 and --text-muted, all of
which are plain aliases of the tokens they now use directly.

Runtime geometry stays inline - absolute positions and heights come from
the meeting data. Only static colour, spacing, radius and type moved to
classNames."
```

---

### Task 3: One ink for the block, and the contrast gate

**Files:**
- Modify: `web/app/components/TimetableGrid.tsx`, `web/app/globals.css`
- Test: `web/lib/__tests__/` — add `subject-ink.test.ts`

**Interfaces:**
- Consumes: the chrome from Tasks 1–2.
- Produces: `--sub-ink-mix` in `globals.css`; `blockColors` returning an `ink` field instead of `text`. Task 4 renders focus rings against these same colours.

This is the accessibility fix. Four light-mode hues fail AA as labels on their own fill, and the `opacity` hierarchy makes two of the three lines worse still. The measured numbers and the reasoning are in "The contrast problem, measured" above — read it before starting; the decision it records is settled and is not yours to revisit.

- [ ] **Step 1: Write the failing test**

The contrast rule is arithmetic, so it can be tested without a browser. The test **reads `globals.css`** rather than restating the hue values — a test that hard-codes them would keep passing after someone retunes a hue, which is the exact regression worth guarding against, and it would also pass before the token exists, giving no red.

Create `web/lib/__tests__/subject-ink.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const CSS = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function block(selector: string): string {
  const m = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, "m").exec(CSS);
  if (!m) throw new Error(`no ${selector} block in globals.css`);
  return m[1];
}
function hues(scope: string): [string, number, number, number][] {
  const out: [string, number, number, number][] = [];
  for (const m of scope.matchAll(/--(sub-[1-8]):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)) {
    out.push([m[1], Number(m[2]), Number(m[3]) / 100, Number(m[4]) / 100]);
  }
  return out;
}
function inkMix(scope: string): number {
  const m = /--sub-ink-mix:\s*([\d.]+)%/.exec(scope);
  if (!m) throw new Error("--sub-ink-mix is not declared");
  return Number(m[1]) / 100;
}

// Derived from --card. Asserted below so a change to --card fails here rather
// than silently invalidating every ratio in this file.
const CARD_LIGHT: RGB = [255, 255, 255];
const CARD_DARK: RGB = [12, 22, 38];

type RGB = [number, number, number];

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const t: RGB =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(t[0] + m) * 255, (t[1] + m) * 255, (t[2] + m) * 255];
}
const toLinear = (v: number) => {
  const n = v / 255;
  return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
};
const fromLinear = (lin: number) => {
  const enc = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, enc * 255));
};
const luminance = (c: RGB) =>
  0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]);
function contrast(a: RGB, b: RGB) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const composite = (fg: RGB, bg: RGB, a: number): RGB =>
  [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)) as RGB;

/**
 * color-mix(in oklab, C, black P%) scales oklab L, a and b by (1 - P). Each of
 * l, m, s is a cube of a linear combination of those, so all three scale by
 * (1 - P)^3 - and linear RGB, being a linear combination of l, m, s, scales by
 * (1 - P)^3 too. So the mix is exactly a scale in linear light.
 */
const mixTowardBlack = (c: RGB, p: number): RGB =>
  c.map((v) => fromLinear(toLinear(v) * Math.pow(1 - p, 3))) as RGB;

const FILL_ALPHA = 0.16; // must match blockColors' bg in TimetableGrid.tsx

describe("subject block ink meets WCAG AA on its own fill", () => {
  it("globals.css still declares the --card values these ratios assume", () => {
    expect(block(":root")).toContain("--card: oklch(1.0000 0.0000 89.88)");
    expect(block("\\.dark")).toContain("--card: oklch(0.2000 0.0350 259.00)");
  });

  for (const [scope, card] of [[":root", CARD_LIGHT], ["\\.dark", CARD_DARK]] as const) {
    const theme = scope === ":root" ? "light" : "dark";
    it(`every hue reaches 4.5:1 in ${theme}`, () => {
      const scoped = block(scope);
      const list = hues(scoped);
      expect(list).toHaveLength(8);
      const p = inkMix(scoped);
      for (const [name, h, s, l] of list) {
        const hue = hslToRgb(h, s, l);
        const ratio = contrast(mixTowardBlack(hue, p), composite(hue, card, FILL_ALPHA));
        expect(ratio, `${name} in ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("would fail without the mix, which is why it exists", () => {
    const [, h, s, l] = hues(block(":root")).find(([n]) => n === "sub-8")!;
    const hue = hslToRgb(h, s, l);
    expect(contrast(hue, composite(hue, CARD_LIGHT, FILL_ALPHA))).toBeLessThan(4.5);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && npx vitest run lib/__tests__/subject-ink.test.ts
```

Expected: the two per-theme cases fail with **`--sub-ink-mix is not declared`**, because Step 3 has not added it yet. That is the red — the test reads the shipped stylesheet, so it cannot pass ahead of the implementation.

The other two cases should pass on this run: the `--card` guard, and "would fail without the mix" at `--sub-8`'s measured 3.02:1. If either of those fails, the numbers this task is built on are wrong — stop and report rather than continuing.

- [ ] **Step 3: Add the token**

In `web/app/globals.css`, inside `:root`, next to the `--sub-*` block:

```css
  /* Blocks put the subject label on a 16% wash of its own hue. Four light
     hues fail AA that way (--sub-8 at 3.02:1), so the ink darkens toward
     black. oklab, not oklch: black has no hue and a polar mix toward it is
     undefined at the endpoint. Dark mode already passes on all eight. */
  --sub-ink-mix: 16%;
```

and inside `.dark`:

```css
  --sub-ink-mix: 0%;
```

- [ ] **Step 4: Rewrite `blockColors`**

```tsx
function blockColors(hueVar: string) {
  return {
    bg: `hsl(var(${hueVar}) / 0.16)`,
    border: `hsl(var(${hueVar}) / 0.55)`,
    ink: `color-mix(in oklab, hsl(var(${hueVar})), black var(--sub-ink-mix))`,
  };
}
```

The field is renamed `text` → `ink` deliberately: every call site must be visited, and a missed one becomes a compile error rather than a silently un-darkened label. Update the `Map` type on `subjectColors` (`:129`) to match.

- [ ] **Step 5: Drop the opacity hierarchy**

In both components' block markup, all three lines take `colors.ink` with **no `opacity`**. Hierarchy moves to size and weight, matching the app's scale:

```tsx
<div className="text-xs font-bold" style={{ color: colors.ink }}>{m.course_code}</div>
<div className="text-xs" style={{ color: colors.ink }}>{m.section}</div>
<div className="mt-1 text-[11px]" style={{ color: colors.ink }}>
  {minutesToHHMM(m.start_min)}–{minutesToHHMM(m.end_min)}
</div>
```

`color` stays inline because it is computed per subject at runtime. The `opacity: 0.85` / `0.75` in `TimetableGrid` and `0.8` / `0.7` in `CompareTimetableGrid` all go.

**Do not remove `CompareTimetableGrid`'s block-level `opacity`** (`:340`) — that is the hover-fade between sides, a different mechanism, and it belongs to Task 4.

- [ ] **Step 6: Run the test again**

```bash
cd web && npx vitest run lib/__tests__/subject-ink.test.ts
```

Expected: all four pass.

- [ ] **Step 7: Verify the rendered colours, not just the arithmetic**

The test proves the maths; it cannot prove the CSS shipped. Stand the preview route up again and, for at least three subjects including one that was failing, read the computed colours out of the browser and compute the ratio on the real values:

```js
const el = document.querySelectorAll('[data-slot="grid-block"]')[0];
getComputedStyle(el).backgroundColor;                       // the fill
getComputedStyle(el.firstElementChild).color;               // the ink
```

Add `data-slot="grid-block"` to the block wrapper in both components so this is addressable — it also matches the `data-slot` convention every vendored component uses. Put the measured ratios in the report.

- [ ] **Step 8: Verify and commit**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts && ls proxy.ts
cd web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: 46 vitest tests now (42 + 4).

```bash
git add web/app/components/TimetableGrid.tsx web/app/globals.css web/lib/__tests__/subject-ink.test.ts
git commit -m "fix(web): bring the subject block labels up to WCAG AA

Blocks put the label on a 16% wash of its own hue, so four light-mode
hues failed AA - --sub-8 worst at 3.02:1. The fill and border keep their
exact values; only the ink darkens, via color-mix toward black at a
theme-aware --sub-ink-mix. Dark mode already passed on all eight and
mixes 0%.

The opacity hierarchy had to go with it: holding 4.5:1 through the 0.85
and 0.75 lines would have needed 28% and 40% mixes, which flattens the
palette to near-black. --muted-foreground was tested as a substitute and
fails too, at 4.17-4.60:1. Hierarchy is size and weight now, as it is
everywhere else since stage 3b.

The ratios are asserted in a unit test rather than left to a screenshot,
so retuning a hue without re-checking contrast fails the build."
```

---

### Task 4: Hover, focus, and a keyboard path through the grid

**Files:**
- Modify: `web/app/components/TimetableGrid.tsx`

**Interfaces:**
- Consumes: `blockColors().ink` and the `data-slot="grid-block"` hook from Task 3.
- Produces: focusable blocks with accessible names. Task 5 changes what they render at small sizes but not how they behave.

Today a block is a `<div>` carrying a `title` attribute. That means: no keyboard access at all, no focus ring, no accessible name beyond a tooltip screen readers treat inconsistently, and — in the compare grid — a fade mechanism wired only to `onMouseEnter` / `onMouseLeave`, so a keyboard or touch user cannot reach it.

- [ ] **Step 1: Give the block an accessible name and a tab stop**

The `title` string already contains everything a user needs; it just is not exposed properly. Build it once and use it for both:

```tsx
const label = `${m.course_code} ${m.section}, ${DAY_LABELS[m.day] ?? m.day} ${minutesToHHMM(m.start_min)} to ${minutesToHHMM(m.end_min)}`;
```

Add the lookup beside `DAYS`:

```tsx
const DAY_LABELS: Record<string, string> = Object.fromEntries(DAYS.map((d) => [d.key, d.label]));
```

Then on the block wrapper, in **both** components:

```tsx
tabIndex={0}
aria-label={label}
title={label}
```

`data-slot="grid-block"` is already on the wrapper from Task 3 Step 7 — leave it.

Keep `title` — it is the mouse affordance and costs nothing. Use the spoken form (`"to"`, not the en dash) for both, so the two never drift.

Do **not** make the block a `<button>`. It performs no action; a button that does nothing on activation is worse than a focusable region.

- [ ] **Step 2: Focus ring**

`globals.css` already carries a global `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }`, so a focusable block inherits a correct ring with no new CSS. Confirm it actually shows — the block sets `overflow: hidden`, and an outline with a positive offset can be clipped by an ancestor. If it is clipped, keep the outline and give the block `focus-visible:z-10` rather than removing `overflow: hidden`, which is what stops long course codes spilling.

- [ ] **Step 3: Hover affordance on both grids**

The main grid gives no hover feedback; the compare grid sets `cursor: pointer` on something that is not clickable. Settle on one recipe for both — a shadow lift, no cursor change:

```tsx
className="transition-shadow duration-150 hover:shadow-md"
```

Remove `cursor: "pointer"` from `CompareTimetableGrid`'s block style. Nothing there is clickable, and a pointer cursor promises otherwise.

- [ ] **Step 4: Make the compare fade reachable without a mouse**

`hoveredSide` is set only by pointer events. Mirror them with focus events so tabbing through blocks drives the same emphasis:

```tsx
onMouseEnter={() => setHoveredSide(m.side)}
onMouseLeave={() => setHoveredSide(null)}
onFocus={() => setHoveredSide(m.side)}
onBlur={() => setHoveredSide(null)}
```

- [ ] **Step 5: Stop the faded side from disappearing**

`opacity: 0.1` on the non-hovered side (`:341`) is effectively invisible — the blocks are meant to recede, not vanish, and at 0.1 their shape is unreadable, which makes the comparison harder rather than easier. Raise it:

```tsx
const opacity = isHiddenBecauseHover ? 0.25 : 1;
```

Rename `isHiddenBecauseHover` to `isDimmedByHover` in the same edit — the block is dimmed, not hidden, and the old name is what made 0.1 look reasonable.

- [ ] **Step 6: Verify in a browser**

Stand up the preview route as in Task 1. Check, in both themes:

1. `Tab` reaches every block in DOM order and each shows a visible focus ring that is not clipped.
2. A screen-reader label is present — read `document.activeElement.getAttribute("aria-label")` after tabbing to a block.
3. Hovering a block in either grid lifts its shadow; no pointer cursor appears.
4. In the compare grid, tabbing to a side dims the other side to a still-legible 0.25, and `Escape`-free blur restores both.
5. Reduced motion: `globals.css` already zeroes transitions under `prefers-reduced-motion: reduce`; confirm the shadow transition respects it.

- [ ] **Step 7: Verify and commit**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts && ls proxy.ts
cd web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

```bash
git add web/app/components/TimetableGrid.tsx
git commit -m "feat(web): give timetable blocks real hover, focus and keyboard access

Blocks were divs with a title attribute: no tab stop, no focus ring, and
an accessible name only if the screen reader chose to read the tooltip.
They are focusable now, with an aria-label carrying the same detail, and
they pick up the global focus-visible ring.

The compare grid's fade was wired to mouse events alone, so no keyboard
or touch user could reach it; focus events now drive it too. The fade
went from 0.1 to 0.25 - at 0.1 the other side is not receding, it is
gone, which makes a comparison view harder to read, not easier."
```

---

### Task 5: Stop short blocks clipping their own text

**Files:**
- Modify: `web/app/components/TimetableGrid.tsx`

**Interfaces:**
- Consumes: the block markup from Tasks 3–4.
- Produces: `blockDetail(height)`. Task 6 does not touch it.

"Denser blocks" in the spec is really this bug. A block renders three lines unconditionally, but its height comes from the meeting duration at 64px/hour:

| Class length | Block height | Content needed | Result |
|---|---|---|---|
| 30 min | 32px | ~62px | two of three lines clipped |
| 45 min | 48px | ~62px | last line clipped |
| 60 min | 64px | ~62px | just fits |
| 90 min | 96px | ~62px | comfortable |

`overflow: hidden` hides the damage, so a half-hour tutorial shows a truncated course code and nothing else. Rather than shrink the type until every case fits — which would make the common 60- and 90-minute blocks needlessly cramped — drop lines as the block gets shorter. The full detail is in the `aria-label` and `title` either way, so nothing becomes unreachable.

- [ ] **Step 1: Add the rule**

```tsx
/**
 * Blocks are sized by duration, so a 30-minute class gets 32px and cannot
 * show three lines. Drop detail as height shrinks rather than shrinking the
 * type - the full string is on the block's aria-label and title regardless.
 */
function blockDetail(height: number): "full" | "code-and-section" | "code-only" {
  if (height >= 56) return "full";
  if (height >= 36) return "code-and-section";
  return "code-only";
}
```

- [ ] **Step 2: Apply it in both components**

```tsx
const detail = blockDetail(height);
...
<div className="text-xs font-bold leading-tight" style={{ color: colors.ink }}>{m.course_code}</div>
{detail !== "code-only" && (
  <div className="text-xs leading-tight" style={{ color: colors.ink }}>{m.section}</div>
)}
{detail === "full" && (
  <div className="mt-1 text-[11px] leading-tight" style={{ color: colors.ink }}>
    {minutesToHHMM(m.start_min)}–{minutesToHHMM(m.end_min)}
  </div>
)}
```

`leading-tight` on all three is the density change: it buys roughly 8px across the three lines, which is what lets a 60-minute block hold its third line without touching the padding.

- [ ] **Step 3: Tighten the padding to match**

`padding: 8` becomes `p-1.5` (6px). Combined with `leading-tight`, a 56px block holds three lines with room to spare, which is where the `"full"` threshold comes from.

- [ ] **Step 4: Check the thresholds against real durations**

In the preview route, render one meeting of each length — 30, 45, 60, 90 and 180 minutes — and confirm in the browser that no block clips its rendered text:

```js
[...document.querySelectorAll('[data-slot="grid-block"]')]
  .map((el) => ({ h: el.getBoundingClientRect().height, clipped: el.scrollHeight > el.clientHeight }))
```

Expected: `clipped: false` for every block. Put the table in the report. If a 45-minute block still clips, the `36` threshold is wrong — raise it and say so rather than leaving one case broken.

- [ ] **Step 5: Verify and commit**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts && ls proxy.ts
cd web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

```bash
git add web/app/components/TimetableGrid.tsx
git commit -m "feat(web): drop block detail by height instead of clipping it

A block is sized by its meeting duration, so a 30-minute class gets 32px
and physically cannot show three lines - overflow:hidden was hiding a
truncated course code. Short blocks now show less rather than showing it
badly, and the full string stays on the aria-label and title.

leading-tight and 6px padding are the density part: together they buy
back enough room for a 60-minute block to keep its third line."
```

---

### Task 6: Retire the legacy aliases and name the grid's width

**Files:**
- Modify: `web/app/globals.css`, `web/app/components/TimetableGrid.tsx`, `web/app/components/ResultsList.tsx`, `web/app/components/CompareSection.tsx`

**Interfaces:**
- Consumes: the token migration from Tasks 2–3, which removed the last references.
- Produces: `GRID_MIN_WIDTH_PX` exported from `TimetableGrid.tsx`.

Two loose ends, both about the grid's geometry escaping into places that cannot see it.

**The five aliases.** `--border-subtle`, `--border-faint`, `--surface-2`, `--shadow-sm` and `--text-muted` exist only to keep inline styles alive during the shadcn migration. `TimetableGrid.tsx` was verified as their sole remaining consumer before this stage began; Tasks 2 and 3 removed those references. Deleting them closes the alias cleanup stage 1 opened.

**The width literal.** `ResultsList.tsx` and `CompareSection.tsx` each hard-code `min-w-[720px]` on the wrapper that lets the grid scroll horizontally on a phone. That number is the grid's own geometry — an 80px time gutter plus five day columns — duplicated twice with no comment pointing at its source. This stage is the one that would break it.

- [ ] **Step 1: Prove the aliases have no consumers left**

```bash
cd web && for t in border-subtle border-faint surface-2 shadow-sm text-muted; do
  echo -n "--$t: "; grep -rn "var(--$t)" app components lib | wc -l
done
```

Expected: `0` for all five. **If any is non-zero, stop** — an earlier task was left incomplete, and deleting a token whose consumer survives makes a colour vanish silently, because CSS resolves an unknown custom property to an invalid value without erroring. Report which token and which file rather than deleting anyway.

- [ ] **Step 2: Delete them**

Remove the five declarations from `:root` and any `.dark` counterparts in `web/app/globals.css`.

**Leave `--overlay` and `--danger-chip-bg` alone** — both are still referenced elsewhere or deliberately reserved. Do not opportunistically tidy any other token; the alias block's remaining entries have consumers.

- [ ] **Step 3: Name the width and export it**

In `TimetableGrid.tsx`, beside the other layout constants:

```tsx
/**
 * The narrowest the grid can render without its columns collapsing: an 80px
 * time gutter plus five day columns at a 128px floor. Consumers wrap the grid
 * in a scroll container at this width on narrow screens - see ResultsList and
 * CompareSection. It lives here because it is this file's geometry.
 */
export const GRID_MIN_WIDTH_PX = 720;
```

- [ ] **Step 4: Consume it at both call sites**

In `ResultsList.tsx` and `CompareSection.tsx`, replace `min-w-[720px]` with the imported constant:

```tsx
import { TimetableGrid, GRID_MIN_WIDTH_PX } from "./TimetableGrid";
...
<div style={{ minWidth: GRID_MIN_WIDTH_PX }}>
```

This adds one inline style to each file. That is a deliberate, disclosed exception to the "exactly three inline styles" constraint, and it is the right trade: a Tailwind arbitrary value cannot read a TypeScript constant, and the alternative — a CSS custom property threaded through `globals.css` — puts the number in a third place rather than one. **Update the constraint's count to five in the stage's report** so the next stage's reviewer is not surprised by it.

- [ ] **Step 5: Confirm every token still resolves**

The standing guard against a silent colour loss:

```bash
cd web && comm -23 \
  <(grep -rhoE "var\(--[a-z0-9-]+" app components --include="*.tsx" | sed 's/var(//' | sort -u) \
  <(grep -oE "^[[:space:]]*--[a-z0-9-]+[[:space:]]*:" app/globals.css | sed 's/[[:space:]]//g; s/:$//' | sort -u)
```

Expected: no output. Any token printed is referenced but undefined.

- [ ] **Step 6: Confirm the scroll behaviour survived**

The width change is the one edit here that can regress a shipped stage-3c behaviour. In the preview route at 375px:

```js
const wrap = document.querySelector('[data-slot="grid-block"]').closest('[style*="min-width"]');
({ min: getComputedStyle(wrap).minWidth, scrolls: wrap.parentElement.scrollWidth > wrap.parentElement.clientWidth,
   pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth })
```

Expected: `min: "720px"`, `scrolls: true`, `pageOverflows: false` — the grid scrolls inside its own container and contributes nothing to page overflow, exactly as stage 3c established.

- [ ] **Step 7: Verify and commit**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts && ls proxy.ts
cd web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

```bash
git add web/app/globals.css web/app/components/TimetableGrid.tsx web/app/components/ResultsList.tsx web/app/components/CompareSection.tsx
git commit -m "chore(web): retire the last legacy aliases and name the grid's width

--border-subtle, --border-faint, --surface-2, --shadow-sm and
--text-muted existed to keep inline styles alive through the shadcn
migration. TimetableGrid was their last consumer and no longer is, which
closes the alias cleanup stage 1 started.

min-w-[720px] was the grid's own geometry hard-coded in two other files
with nothing pointing at its source - the stage most likely to change it
is this one. It is a named export now."
```

---

### Task 7: Verify the stage

**Files:** none — this task changes nothing unless it finds something.

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence the final review reads.

- [ ] **Step 1: Inline-style census**

```bash
cd web && grep -c 'style={{' app/components/TimetableGrid.tsx
grep -rn 'style={{' app/components/ResultCard.tsx app/components/CompareSection.tsx app/components/ResultsList.tsx app/\(app\)/page.tsx
```

The grid started at 26. Every survivor must be runtime geometry — absolute position, height, lane width, or the per-subject colour. Report the count and justify each remaining one by category. Outside the grid, expect five: the score bar's width, the two compare swatches, and the two `GRID_MIN_WIDTH_PX` wrappers Task 6 added.

- [ ] **Step 2: No colour literals**

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer
git diff master...HEAD -- web/ | grep "^+" | grep -oE '#[0-9a-fA-F]{3,8}\b|\b(white|black|crimson|red|blue|green)\b' | sort -u
```

Expected: `black` only, and only from the `color-mix` ink recipe. Anything else is a violation.

- [ ] **Step 3: Every token resolves**

Re-run Task 6 Step 5. Expected: no output.

- [ ] **Step 4: Full gate**

```bash
cd api && .venv/bin/pytest tests/ -q
cd ../web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: 74 Python, 46 vitest, `tsc` clean, `next build` clean with `ƒ Proxy (Middleware)` present, eslint at **exactly** the two pre-existing problems.

- [ ] **Step 5: The subject-to-hue mapping is unchanged**

The constraint that most easily breaks silently. In the preview route, render a fixed six-subject timetable and record each subject's computed fill; compare against the same render on `master`:

```js
Object.fromEntries([...document.querySelectorAll('[data-slot="grid-block"]')]
  .map((el) => [el.getAttribute("aria-label").split(" ").slice(0, 2).join(" "),
                getComputedStyle(el).backgroundColor]));
```

The *values* legitimately differ from `master` only if a hue changed — none did this stage — so expect them identical. What must hold regardless: the same subject maps to the same hue index. Report both maps.

- [ ] **Step 6: Contrast, on rendered pixels**

For all eight hues, in light mode, read the block's computed background and its label's computed colour and compute the ratio. All eight ≥ 4.5:1. Repeat in dark. Put the sixteen numbers in the report — this is the stage's headline claim and a screenshot does not establish it.

- [ ] **Step 7: Keyboard pass**

Tab through both grids. Every block reachable, ring visible and unclipped, `aria-label` correct, and in the compare grid focus dims the other side. Report anything that does not hold.

- [ ] **Step 8: Desktop and phone**

At 1280px: the grid renders as it did on `master` apart from the intended block changes. At 375px: the grid scrolls inside its container, the page does not overflow, and no block clips its text. Console clean in both — zero errors, zero warnings, no hydration mismatch.

- [ ] **Step 9: Tear down**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts && ls proxy.ts && git status --short
```

`proxy.ts` present; nothing untracked but the repo's pre-existing `kite-export.mp4`.

- [ ] **Step 10: Report**

No commit unless a step found something. If one did, fix it in its own commit and say which step caught it.
