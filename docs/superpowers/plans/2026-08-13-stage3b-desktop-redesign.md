# Stage 3b — Desktop Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app look deliberately designed — one spacing and type scale, real surfaces, result cards that help a student choose — and retire the last 120 inline styles outside the timetable grid.

**Architecture:** Stage 3a split `page.tsx` into six focused files, so each surface can now be restyled in a diff a reviewer can hold in their head. This stage works file by file, converting inline `style={{}}` to Tailwind classNames against a fixed scale, adopting Card / Badge / Separator / Tooltip, and reworking the one piece of information design that is actually wrong: a result card headed by a score of `240.0`.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui `base-nova` over `@base-ui/react`, Vitest.

**Design spec:** `docs/superpowers/specs/2026-08-12-stage3-layout-and-responsive-design.md`

**Branch:** all tasks land on `feature/stage3b-redesign`, cut from `master`. Create it before Task 1:

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer && git checkout -b feature/stage3b-redesign
```

## Global Constraints

Every task's requirements implicitly include this section.

- **Never add a colour rule outside a cascade layer.** Stage 2a shipped a Critical when an unlayered `button { color: var(--foreground) }` in `globals.css` outranked Tailwind's `@layer utilities` — unlayered declarations beat layered ones regardless of specificity — blacking out every filled-navy button in the light theme, invisible in dark because `--foreground` and `--primary-foreground` are equal there. If a global element rule is genuinely needed it goes in `@layer base`. `globals.css` carries a comment saying this; read it before editing that file.
- **No hex or named colour literals.** Semantic tokens only: `bg-card`, `text-muted-foreground`, `border-border`. The one exception already in the tree is `TimetableGrid.tsx`'s `hsl(var(--sub-N) / …)` subject hues, which this stage does not touch.
- **Never mix `style={{}}` and `className` on the same element**, with exactly one sanctioned exception: the two compare swatches in Task 7, whose colours are `hsl(var(--cmp-N) / …)` and cannot be expressed as static classes. Their geometry still moves to classes. The rule exists to stop hand-tuned pixel values competing with the scale, and that exception does not.
- **Do not change application state or the `/optimize/ranked` payload.** This stage restyles; it does not alter what the optimiser is asked for. `runOptimize` and `usePreferences.ts`'s defaults are off limits.
- **Do not touch `web/app/components/TimetableGrid.tsx`.** Its 26 inline styles and its subject hues are stage 4.
- **Do not touch `web/lib/sectionOptions.ts`** — the section-lock contract — or `web/lib/schedule.ts`, whose 25 tests must keep passing untouched.
- **Do not build sign-out.** The header reads `Logged in as: none` and there is no sign-out anywhere in the app. That is a missing feature, not a styling defect; leave room for an account control, build nothing.
- **Responsive behaviour is stage 3c.** Do not add breakpoints beyond what a container needs to not overflow. If a task tempts you into stacking columns, that is the other plan.
- `web/proxy.ts` is the auth gate. Tasks needing a browser delete it temporarily and must restore it before committing.
- Python backend untouched: `api/` stays at 74 passing tests. Vitest stays at 42.
- Lint baseline: `npx eslint .` reports two PRE-EXISTING problems — `prefer-const` in `app/auth/callback/route.ts`, `@next/next/no-img-element` in `app/login/page.tsx`. Neither is in scope. The bar is **no new problems**.

## The scale

Every task styles against this. It is not a suggestion — the point of the stage is that one scale is applied everywhere, and a task inventing its own step defeats it.

| Role | Class |
|---|---|
| Page container | `mx-auto w-full max-w-6xl px-6 py-5` |
| Section stack | `space-y-6` |
| Card padding | `p-5` |
| Grid/flex gap | `gap-4`, tight groups `gap-2` |
| Page title | `text-3xl font-semibold tracking-tight` |
| Section heading | `text-lg font-semibold` |
| Sub-heading | `text-sm font-semibold` |
| Body | `text-sm` |
| Secondary | `text-sm text-muted-foreground` |
| Fine print | `text-xs text-muted-foreground` |
| Numeric emphasis | `tabular-nums` |

`max-w-6xl` is 1152px against the current 1200 — a deliberate tightening, not a rounding error.

Everything currently written as `fontSize: 13` becomes `text-sm`, `fontSize: 11`/`12` becomes `text-xs`, `fontWeight: 600`/`700`/`800`/`900` collapses to `font-semibold` unless it is the page title. Resist preserving the old pixel values; that is what makes it look hand-tuned rather than designed.

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

Before committing:

```bash
rm -rf web/app/preview-tmp web/.next/types .playwright-mcp web/.playwright-mcp
git checkout -- web/proxy.ts
ls -la web/proxy.ts   # confirm it exists - a missing proxy disables auth
```

Deleting `web/.next/types` matters: a stale `validator.ts` referencing the removed preview route makes `tsc` fail with `TS2307`.

**A note on iCloud.** This repo has produced `foo 2.tsx` duplicate files five times during the redesign. `.gitignore` now catches them so they cannot be committed, but they still appear on disk and will show in your greps. If a count looks doubled, check for a `" 2.tsx"` twin before believing it.

## File Structure

| File | Inline styles now | After |
|---|---|---|
| `web/app/(app)/page.tsx` | 6 | 0 |
| `web/app/components/Header.tsx` | 4 | 0 |
| `web/app/components/CoursePicker.tsx` | 28 | 0 |
| `web/app/components/PreferencesPanel.tsx` | 21 | 0 |
| `web/app/components/ResultsList.tsx` | 10 | 0 |
| `web/app/components/ResultCard.tsx` | 10 | 0 |
| `web/app/components/CompareSection.tsx` | 16 | 0 |
| `web/app/login/page.tsx` | 14 | 0 |
| `web/app/request-access/page.tsx` | 11 | 0 |
| `web/app/components/TimetableGrid.tsx` | 26 | **26 — stage 4** |
| `web/components/ui/{card,badge,separator,tooltip}.tsx` | — | created, Task 2 |

146 today, 26 after. No new files beyond the four generated components.

---

### Task 1: Fix the font

**Files:**
- Modify: `web/app/(app)/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

One line, its own commit, because it changes the typeface on every screen in the app and a reader bisecting a future regression should find it isolated.

`page.tsx:306` sets `fontFamily: "system-ui"` on the root `<div>`. `layout.tsx` loads Geist and stage 1 mapped `--font-geist-sans` into `@theme`; `globals.css` sets `body { font-family: var(--font-geist-sans), … }`. This one inline declaration has been overriding all of it since before the redesign began.

- [ ] **Step 1: Capture the before**

Preview route, both themes. Screenshot the header. You are about to change every glyph in the app, so have the before.

- [ ] **Step 2: Remove the override**

In `page.tsx:306`, delete `fontFamily: "system-ui",` from the root `<div>`'s style object. Leave the rest of that object alone — Task 3 owns it.

- [ ] **Step 3: Confirm the app now renders in Geist**

```js
getComputedStyle(document.querySelector('h1')).fontFamily
```

Expected: a value beginning with the Geist family, not `system-ui`. Report the literal string you got, before and after.

- [ ] **Step 4: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/page.tsx"
git commit -m "fix(web): stop overriding Geist with system-ui

layout.tsx loads Geist, stage 1 mapped --font-geist-sans into @theme, and
globals.css sets it on body - and then one inline fontFamily on the root
div overrode all of it. Every screen has been system-ui since before the
redesign started.

Its own commit because it changes the typeface everywhere."
```

---

### Task 2: Install Card, Badge, Separator and Tooltip

**Files:**
- Create: `web/components/ui/card.tsx`, `badge.tsx`, `separator.tsx`, `tooltip.tsx`
- Verify unchanged: `web/app/globals.css`

**Interfaces:**
- Consumes: the shadcn setup from stage 1.
- Produces, imported by later tasks from `@/components/ui/*`:
  - `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`
  - `Badge`, `badgeVariants` — variants `default | secondary | destructive | outline | ghost | link`
  - `Separator`
  - `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`

Two facts established by reading the installed `@base-ui/react` 1.7.0 source, so later tasks do not have to guess:

- **`TooltipProvider` is optional.** `TooltipRoot.js` contains no reference to `TooltipProviderContext`, and that context is created with `undefined` as its default. A bare `Tooltip` works. The provider only shares delay timing between tooltips, so mount it once in `layout.tsx` if you want grouped delays — but nothing breaks without it.
- **`Badge`'s `destructive` variant is a tinted background** (`bg-destructive/10 text-destructive`), not a solid fill. If you want a solid red badge, `default` with a class override is wrong — use the tinted one, which is what the design calls for anyway.

- [ ] **Step 1: Record the stylesheet hash**

```bash
cd web && md5 -q app/globals.css
```

- [ ] **Step 2: Add the components**

```bash
cd web && npx shadcn@latest add card badge separator tooltip --yes --overwrite
```

None needs a new dependency — `@base-ui/react` and `class-variance-authority` are already installed.

- [ ] **Step 3: Check the CLI did not touch the stylesheet**

```bash
cd web && md5 -q app/globals.css && git diff --stat app/globals.css
```

If the hash moved, inspect the diff and revert any change to `:root`, `.dark` or `@theme inline` with `git checkout -- app/globals.css`, then re-verify. Stage 1 established that `shadcn` rewrites tokens it recognises; do not accept a token change as harmless.

- [ ] **Step 4: Confirm the exports later tasks import**

```bash
cd web && grep -h "^export" components/ui/{card,badge,separator,tooltip}.tsx
```

Expected: the names in the Interfaces block above. If any is missing, stop and report — later tasks are written against them.

- [ ] **Step 5: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Nothing visible changes — nothing consumes these yet.

- [ ] **Step 6: Commit**

```bash
git add web/components/ui web/package.json web/package-lock.json
git commit -m "chore(web): add card, badge, separator and tooltip

Deferred out of stage 2b because they are surface components and this is
the pass that designs the surfaces. Generated source only."
```

---

### Task 3: The page shell and Header

**Files:**
- Modify: `web/app/(app)/page.tsx`, `web/app/components/Header.tsx`

**Interfaces:**
- Consumes: `Card` and friends, `Separator` from Task 2.
- Produces: the established scale. Every later task follows what lands here.

Ten inline styles between the two files, and the frame every other surface sits in. Get the container, the type scale and the section rhythm right here; the remaining tasks are then "apply the same thing to my file".

- [ ] **Step 1: Restyle the page container**

`page.tsx:306` is currently:

```tsx
<div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px", width: "100%" }}>
```

Becomes:

```tsx
<div className="mx-auto w-full max-w-6xl px-6 py-5">
```

- [ ] **Step 2: Restyle the header**

`Header.tsx` has four style objects: the flex row, the `<h1>`, the subtitle, and the button group. Apply the scale:

```tsx
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">HKUST Timetable Optimizer</h1>
        <p className="mt-1 text-sm text-muted-foreground">Build a schedule with soft and hard preferences</p>
        <p className="mt-1 text-sm"><span className="font-semibold">Logged in as:</span> {email}</p>
      </div>
      <div className="flex items-center gap-2">
        {/* ThemeToggle, Feedback anchor, How to use?, Optimize - unchanged */}
      </div>
    </div>
```

The subtitle and identity line are currently `<div>`s; `<p>` is the honest element for a line of prose. Keep the identity line's text exactly as it reads today — the copy is not this task's to change.

- [ ] **Step 3: Give the two body columns real Cards**

`page.tsx` wraps the **left** column in a hand-rolled bordered `<div>` (`border: "1px solid var(--border)", borderRadius: 12, padding: 14`). Replace that one with a `Card`, and give the body the section rhythm:

```tsx
      <div className="mt-6 grid grid-cols-2 gap-4">
        <Card className="p-5">
          {/* term picker + CoursePicker */}
        </Card>
        <PreferencesPanel hard={hard} soft={soft} weights={weights} error={error} />
      </div>
```

**Do not wrap `PreferencesPanel` in a Card here.** Its own root element is already a bordered container carrying `maxHeight: 520, overflowY: "auto"` (`PreferencesPanel.tsx:39`), and that element belongs to Task 5. Wrapping it would nest one scroll container inside another and give the right column two borders. Task 5 converts that root into the Card.

Keep `grid-cols-2` unprefixed: stacking is stage 3c.

- [ ] **Step 4: Retire the remaining shell styles**

`page.tsx` should reach zero inline styles. The Term label and its wrapper take the scale: `<Label htmlFor="term-select" className="mb-2 block text-sm font-semibold">Term</Label>`.

- [ ] **Step 5: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 6: Confirm both files are clean**

```bash
cd web && grep -n "style={{" "app/(app)/page.tsx" app/components/Header.tsx || echo "  both files free of inline styles"
```

- [ ] **Step 7: Look at it, both themes**

Preview route. The header should read as a title with two supporting lines, not three similar-weight rows. The two columns should be cards with visible, consistent padding. Confirm the Optimize button still disables with no courses, and the theme toggle still shows the active option.

Screenshot both themes and describe what changed in your report — this is the first task where the app should look different, and a reviewer needs your account of it.

- [ ] **Step 8: Commit**

```bash
git add "web/app/(app)/page.tsx" web/app/components/Header.tsx
git commit -m "feat(web): apply the type and spacing scale to the shell

Container, header and the two body columns. The hand-rolled bordered divs
become Cards; per-element fontSize/marginTop give way to one scale.

This is the frame the remaining surfaces are styled against."
```

---

### Task 4: CoursePicker

**Files:**
- Modify: `web/app/components/CoursePicker.tsx`

**Interfaces:**
- Consumes: `Card`, `Badge`, `Separator` from Task 2; the scale from Task 3.
- Produces: nothing downstream.

Twenty-eight inline styles, the most in any file this stage touches, and the surface a new user meets first. It contains the search box, the selected-course chips with their section-lock selects, the result list, and the empty states.

- [ ] **Step 1: Restyle the search row**

The bordered wrapper with the lucide `Search` icon and the border-less `Input` keeps that arrangement — the wrapper supplies the frame deliberately. Convert its inline styles to classes, keeping the `indexReady` background swap:

```tsx
        <div className={`flex items-center gap-2 rounded-xl border border-border px-3 py-2 ${indexReady ? "bg-card" : "bg-muted"}`}>
```

Read the current expression before rewriting it; that swap is how the field signals the course index is still loading.

- [ ] **Step 2: Restyle the selected-course chips**

Each selected course is a bordered box holding the code, a remove button and the Lecture/Tutorial/Lab selects. Give it a `Card` with tight padding, and use `Badge` for the `L+T matching` marker that currently renders as a hand-styled span with `--warn-bg` / `--warn-text`.

`Badge`'s `destructive` variant is tinted rather than solid; for the matching marker use `variant="secondary"` or `outline` — pick one, apply it to every instance, and say which in your report.

- [ ] **Step 3: Give the empty states real treatment**

Three states currently carry the whole burden of an empty app as bare text: `No courses selected.`, `Start typing to search courses.`, and the "no matches" state. Give each a centred block with a muted line of copy at `text-sm text-muted-foreground`, inside the surface it belongs to. Keep the wording; changing copy is not this task.

- [ ] **Step 4: Retire the rest**

Work through the remaining style objects — the result rows, the tip line, the loading line, the scroll container — against the scale.

- [ ] **Step 5: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

```bash
cd web && grep -n "style={{" app/components/CoursePicker.tsx || echo "  no inline styles remain"
```

- [ ] **Step 6: Confirm the section-lock feature still works**

This file holds the professor and section locks — the feature the app exists for, and the one whose behaviour took the longest to get right. Restyling must not disturb it. With the API running, add `MATH 1003` and confirm, in both themes:

1. The Lecture trigger reads `Any` before the dropdown is opened.
2. Opening it shows the `Professor` and `Lecture` group headings.
3. Picking a lecture narrows the Tutorial options to that lecture's group.
4. Switching lecture clears a tutorial pin that no longer belongs.
5. Picking a professor clears any lecture pin, and vice versa.
6. Search filters as you type, and the field is disabled until the index loads.

- [ ] **Step 7: Commit**

```bash
git add web/app/components/CoursePicker.tsx
git commit -m "feat(web): restyle CoursePicker onto the scale

Twenty-eight inline styles gone. The selected-course chips become Cards,
the matching marker becomes a Badge, and the three empty states get real
treatment rather than a bare line of text.

Section-lock behaviour re-verified end to end - this file owns it."
```

---

### Task 5: PreferencesPanel

**Files:**
- Modify: `web/app/components/PreferencesPanel.tsx`

**Interfaces:**
- Consumes: `Card`, `Separator` from Task 2; the scale from Task 3.
- Produces: nothing downstream.

Twenty-one inline styles: the hard box, the soft box, the weights row, the error message.

- [ ] **Step 1: Restyle the two preference boxes**

The panel's **root** element (`PreferencesPanel.tsx:39`) is a bordered `<div>` carrying `maxHeight: 520, overflowY: "auto"`. It becomes the right column's `Card`:

```tsx
    <Card className="max-h-[520px] overflow-y-auto p-5">
```

Task 3 deliberately left `PreferencesPanel` unwrapped in `page.tsx` for this reason — the scroll container is yours, and two of them nested would be a bug.

Inside it, the hard and soft boxes are each a bordered `<div>` with a heading and an info trigger. They become `Card`s one level down, with `CardHeader` / `CardTitle` carrying the heading and the `Dialog` trigger sitting as a `CardAction`.

The two boxes must read as siblings of equal weight — they are hard and soft preferences, not a primary and a secondary.

- [ ] **Step 2: Restyle the sub-headings and the weights row**

`Must be free`, `No classes after`, `No classes before`, `Prefer free` become `text-sm font-semibold`. The weights row's three label/select pairs take `text-sm` with the label at a fixed width; keep the existing `w-36` on the label spans so the three selects line up.

- [ ] **Step 3: Restyle the error message**

It currently renders as `color: var(--danger)` with `whiteSpace: "pre-wrap"`. The conflict message is multi-line, so the `pre-wrap` is load-bearing — keep it as `whitespace-pre-wrap`. Give the block a tinted surface using the existing `--danger-bg` / `--danger-border` tokens so it reads as an error panel rather than red text.

- [ ] **Step 4: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

```bash
cd web && grep -n "style={{" app/components/PreferencesPanel.tsx || echo "  no inline styles remain"
```

- [ ] **Step 5: Confirm the controls still behave**

Both themes:

1. Five day checkboxes on one row under each of "Must be free" and "Prefer free" — the grid from stage 2b, not wrapped.
2. Clicking a day **letter** toggles its checkbox.
3. Each cutoff dropdown is disabled until its own day is ticked, and ticking `hard-after-Mo` enables only that row.
4. Both info dialogs open and close on Escape.
5. Set hard no-before Mo to 15:00 and hard no-after Mo to 12:00, click Optimize, and confirm the multi-line conflict error renders in the panel with its line breaks intact.

- [ ] **Step 6: Commit**

```bash
git add web/app/components/PreferencesPanel.tsx
git commit -m "feat(web): restyle PreferencesPanel onto the scale

The hard and soft boxes become sibling Cards of equal weight, and the
conflict error gets a tinted panel instead of bare red text. Its
whitespace-pre-wrap is preserved - that message is multi-line."
```

---

### Task 6: ResultsList and ResultCard

**Files:**
- Modify: `web/app/components/ResultsList.tsx`, `web/app/components/ResultCard.tsx`

**Interfaces:**
- Consumes: `Card`, `Badge` from Task 2; the scale from Task 3.
- Produces: nothing downstream.

Twenty inline styles, and the one piece of information design in the app that is actually wrong.

**The problem.** The card is headed `Score 240.0`. In a representative run the six returned options scored 240.0, 240.0, 240.0, 239.0 — the absolute number means nothing to a student, and the differences are within a point. The headline is doing no work.

**The fix.** Lead with a bar scaled against the best result in the set, so options a point apart read as near-identical bars rather than unexplained numbers, with the raw score kept as secondary text because it is real information.

- [ ] **Step 1: Compute the bar in `ResultsList`**

The best score is a property of the set, so `ResultsList` computes it and passes it down — `ResultCard` must not have to know about its siblings.

```tsx
  const bestScore = results.length > 0 ? Math.max(...results.map((r) => r.score)) : 0;
```

Pass `bestScore` to each `ResultCard`.

- [ ] **Step 2: Add the bar to `ResultCard`**

```tsx
  // Scaled against the best result rather than against the range: two options
  // a point apart genuinely are near-identical, and normalising to the range
  // would inflate a 1.0 difference into a full-width gap. The delta label
  // carries the precision the bar deliberately does not.
  const pct = bestScore > 0 ? Math.max(0, Math.min(100, (result.score / bestScore) * 100)) : 100;
  const delta = result.score - bestScore;
```

```tsx
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-semibold tabular-nums text-muted-foreground">
            {delta === 0 ? "best" : delta.toFixed(1)}
          </span>
        </div>
```

The `style={{ width }}` is the one legitimate inline style this stage adds: the value is computed at runtime and Tailwind cannot express it as a class. It carries no `className` on the same element, so it does not breach the no-mixing rule.

`bestScore > 0` guards division by zero. Scores here are always positive — the optimiser's rejection score is filtered out before results reach the UI — but a zero best would otherwise produce `NaN%`.

- [ ] **Step 3: Restyle the card**

The card becomes a `Card`. Its facts — free days, days on campus, gaps, latest end — become a compact `text-sm` list rather than four separate lines of differing weight, with numbers in `tabular-nums` so they align down the column. The raw score moves to `text-xs text-muted-foreground`.

The penalty and bonus chips become `Badge`s: penalties `variant="destructive"` (tinted, per Task 2's note), bonuses `variant="secondary"`.

**Preserve:** the `role="button"`, `tabIndex`, the Enter/Space `onKeyDown`, the active-card border treatment, and `e.stopPropagation()` on the pin button. That last one is why clicking Pin does not also select the card.

- [ ] **Step 4: Restyle the results header and the summary block**

`ResultsList` holds the `Results / considered N, returned M` header and, below the grid, the selected option's `Score:` summary with its chips. Both take the scale; the summary's `active?.` optional guards must survive — `activeIdx` can point past the end of a shorter set.

- [ ] **Step 5: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

```bash
cd web && grep -n "style={{" app/components/ResultsList.tsx app/components/ResultCard.tsx
```

Expected: exactly one match, the computed bar width in `ResultCard.tsx`.

- [ ] **Step 6: Look at the bars against real results**

With the API running, add `MATH 1003` and optimize. Confirm, both themes:

1. The top card's label reads `best`; the others read their delta, e.g. `-1.0`.
2. Bars for options within a point of each other look near-identical — that is correct, not a bug to fix.
3. Clicking a card still selects it, updates the summary and the timetable.
4. Enter and Space select a focused card.
5. Pin does not also select.
6. Numbers align down the column.

Report the actual scores and deltas you saw.

- [ ] **Step 7: Commit**

```bash
git add web/app/components/ResultsList.tsx web/app/components/ResultCard.tsx
git commit -m "feat(web): lead result cards with a relative score bar

The card was headed 'Score 240.0' while a representative run returned
240.0/240.0/240.0/239.0 - a number that is meaningless in absolute terms
and near-identical across options, so it could not help anyone choose.

The bar is scaled against the best result, not the range: options a point
apart genuinely are near-identical and normalising would inflate that. The
delta label carries the precision. The raw score stays as secondary text."
```

---

### Task 7: CompareSection

**Files:**
- Modify: `web/app/components/CompareSection.tsx`

**Interfaces:**
- Consumes: `Card`, `Badge`, `Separator` from Task 2; the scale from Task 3.
- Produces: nothing downstream.

Sixteen inline styles, plus the one structural change: compare is currently the last thing on the page, below the results and the selected schedule, and reads as a feature you discover by scrolling.

- [ ] **Step 1: Promote it to a peer section**

Today it is a `<div>` with a top border, nested at the bottom of the results block. Give it a `Card` of its own with a `CardHeader`, so it reads as a peer of Results rather than a footnote.

**Keep it inside the `{result && (…)}` block.** That is deliberate: pins are session-only state with no persistence, so there can be no pins without a result in the same session. Promoting means visual weight, not relocation.

- [ ] **Step 2: Restyle the pinned list**

Each pinned chip holds a colour swatch, the rename `Input`, the score and an unpin button. Everything takes the scale except the swatch colours.

The two swatch `<span>`s currently carry a six-property style object each (`CompareSection.tsx:96-105` and `:125-134`): `display`, `width`, `height`, `borderRadius`, plus `background: "hsl(var(--cmp-a) / 0.3)"` and `border: "1px solid hsl(var(--cmp-a) / 0.6)"`. **Move the four geometry properties to classes and keep only the two colour ones**, because `hsl(var(--cmp-N) / …)` is a token-derived colour Tailwind cannot express as a static class:

```tsx
            <span
              className="inline-block size-3 rounded-[3px]"
              style={{
                background: "hsl(var(--cmp-a) / 0.3)",
                border: "1px solid hsl(var(--cmp-a) / 0.6)",
              }}
            />
```

This is the one place the stage knowingly puts `style` and `className` on the same element. The no-mixing rule exists to stop hand-tuned pixel values competing with the scale; here the geometry is entirely in classes and the style object holds only what classes cannot express. Say in your report that you did this deliberately.

- [ ] **Step 3: Restyle the selectors and the hint**

The A/B rows and the `Pin at least 2 options to enable comparison` hint take `text-sm`. The hint becomes the section's empty state rather than an italic afterthought.

- [ ] **Step 4: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

```bash
cd web && grep -c "style={{" app/components/CompareSection.tsx
```

Expected: 2, the two swatch colours. Report which lines they are.

- [ ] **Step 5: Confirm compare still works**

With the API running, optimize and pin two options. Both themes:

1. Both appear in the pinned list with their swatch colours.
2. Renaming one updates the text in the A and B dropdowns — those are Base UI Selects whose trigger label resolves from an `items` prop, so the rename has to reach `items`, not just the children.
3. Choosing one in A and another in B renders the overlay grid with both.
4. Unpinning a compared option removes it and clears that selector.
5. With fewer than two pinned, the hint shows.

- [ ] **Step 6: Commit**

```bash
git add web/app/components/CompareSection.tsx
git commit -m "feat(web): promote Compare to a peer section

It was the last thing on the page, below the results and the selected
schedule, and read as a feature you find by scrolling. It gets a Card and
a header so it sits alongside Results.

Still rendered inside {result && ...}: pins are session-only, so there can
be no pins without a result in the same session."
```

---

### Task 8: The login and request-access pages

**Files:**
- Modify: `web/app/login/page.tsx`, `web/app/request-access/page.tsx`

**Interfaces:**
- Consumes: `Card` from Task 2; the scale from Task 3.
- Produces: nothing downstream.

Twenty-five inline styles across the two public pages. They are the only screens an unauthenticated visitor sees, and they have had no design attention in the whole redesign beyond the button and input migrations.

- [ ] **Step 1: Restyle the login page**

The centred panel becomes a `Card`. The `--login-canvas` gradient background and the `--login-badge` icon tile stay — they are theme tokens defined for these pages. The heading takes `text-2xl font-semibold tracking-tight`, the subtitle `text-sm text-muted-foreground`.

Keep the three controls at `h-11`: that is a deliberate 44px tap target set in `ec4c70d`, not an arbitrary height.

The `--- Or ---` divider becomes a `Separator` with the word centred over it.

- [ ] **Step 2: Restyle the error and notice lines**

They currently render as bare coloured text using `--danger` and `--pin-text`. Give them the same tinted-panel treatment Task 5 gave the preferences error, so a failed magic link reads as a message rather than red text.

- [ ] **Step 3: Restyle request-access**

Same treatment: the panel becomes a `Card`, the copy takes the scale, the Copy-email button keeps `variant="default"` — it is the only action on the page and was deliberately promoted in `ec4c70d`.

- [ ] **Step 4: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

```bash
cd web && grep -n "style={{" app/login/page.tsx app/request-access/page.tsx || echo "  no inline styles remain"
```

The pre-existing `no-img-element` warning on `login/page.tsx` stays — it concerns the logo, not anything this task touches. Do not fix it.

- [ ] **Step 5: Look at both pages**

These are public, so no preview route is needed — visit `/login` and `/request-access` directly. Both themes. Confirm the three login controls still measure 44px, the placeholder is legible in dark mode, and submitting an empty email still surfaces the validation error.

- [ ] **Step 6: Commit**

```bash
git add web/app/login/page.tsx web/app/request-access/page.tsx
git commit -m "feat(web): restyle the login and request-access pages

The only screens an unauthenticated visitor sees, and the last two with
inline styles outside the timetable grid. Panels become Cards; the error
and notice lines get tinted panels instead of bare coloured text.

The 44px control height from ec4c70d is preserved - it is a deliberate tap
target, not an arbitrary value."
```

---

### Task 9: Verify the stage

**Files:**
- Modify: none expected. If a step requires a change, make it and say so.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Confirm the inline styles are gone**

```bash
cd web && grep -rc "style={{" app components --include="*.tsx" | grep -v ":0$" | grep -v "components/ui/" | sort -t: -k2 -rn
```

Expected: `TimetableGrid.tsx:26`, `ResultCard.tsx:1` (the computed bar width), `CompareSection.tsx:2` (the two swatch colours). Nothing else. Watch for `" 2.tsx"` iCloud twins inflating the list — check before believing a duplicate.

- [ ] **Step 2: Confirm no colour literals and no unlayered colour rules**

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer
git diff master...HEAD -- web/app web/components | grep "^+" | grep -oE '#[0-9a-fA-F]{3,8}\b|"white"|"crimson"' | sort -u || echo "  no colour literals"
cd web && grep -n "^[a-z]" app/globals.css
```

For the second: read each match. Any bare element selector outside `@layer base` that sets a colour property is the stage 2a Critical returning. `body` and `:focus-visible` are expected and safe — `body` sets the page ground and no component renders as `body`; `:focus-visible` sets `outline`, not colour.

- [ ] **Step 3: Confirm the font fix held**

```bash
cd web && grep -rn "system-ui" app --include="*.tsx" || echo "  no system-ui override remains"
```

- [ ] **Step 4: Full gate**

```bash
cd api && .venv/bin/pytest tests/ -q
cd ../web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: 74 Python, 42 vitest, clean, eslint at its two pre-existing problems.

- [ ] **Step 5: Confirm the payload is still untouched**

This stage restyles and must not have changed what the optimiser is asked for. Capture a request body and check it against the shape stage 3a locked in. Drive: term default `2610`, add `MATH 1003`, hard "Must be free" Mo, hard "No classes after" Tu at 12:00, Gap shape "Prefer one long gap", uncheck "Prefer at least one free weekday". Expected body:

```json
{"term":"2610","course_codes":["MATH 1003"],"max_solutions":6,"search_limit":2000,
 "prefs":{"prefer_one_free_day":false,"gap_shape":"consolidated","hard_free_days":["Mo"],
 "hard_no_after":{"Tu":"12:00"},"hard_no_before":{},"soft_free_days":[],"soft_no_after":{},
 "soft_no_before":{},"weights":{"gaps_per_min":0.1,"late_after_per_min":0.5,"early_before_per_min":0.5}},
 "instructor_locks":{},"section_locks":{}}
```

Quote what you captured. Any difference is a defect in this stage.

- [ ] **Step 6: Whole-app pass, both themes**

Add two courses; pin a lecture on one; set a hard free day and a cutoff; optimize; read the score bars; select different cards; pin two; rename one; compare them; unpin one; open both explainer dialogs and the help dialog; visit `/login` and `/request-access`.

Console must show no errors, no warnings, no hydration mismatch. Note that a warning naming `fdprocessedid` comes from a browser form-scanner extension, not the app — that string appears nowhere in the codebase.

Screenshot the main page in both themes and describe the result. This stage's whole purpose is that the app looks designed; your account of whether it does is the deliverable.

- [ ] **Step 7: Clean up**

```bash
cd web && rm -rf app/preview-tmp .next/types .playwright-mcp && cd .. && git checkout -- web/proxy.ts; git status --short; ls -la web/proxy.ts
```

Expected: clean apart from the repo's pre-existing untracked `kite-export.mp4`, and `proxy.ts` present.

- [ ] **Step 8: Commit**

Only if a step required a change. Otherwise report that no commit was needed — a verification task with an empty diff is a success, not a gap.

---

## Notes for the implementer

- **One scale, applied everywhere.** The table near the top is the contract. A task that invents its own step — `text-[13px]`, `p-3.5`, a one-off `gap-3` — defeats the stage even if that surface looks fine alone. If the scale genuinely lacks a step you need, say so in your report rather than improvising.
- **Never set a colour on an element selector outside `@layer base`.** Stage 2a shipped a Critical exactly that way and it was invisible in dark mode. `globals.css` carries a comment explaining the mechanism; read it before editing that file.
- **Three inline styles survive this stage on purpose**: the score bar's computed width (Task 6) and the two compare swatch colours (Task 7). All three hold values Tailwind cannot express as static classes — a runtime percentage and two `hsl(var(--cmp-N) / …)` tokens. The bar's element carries no `className`; the two swatches do, and that is the single sanctioned exception to the no-mixing rule. Everything else in app code goes.
- **`next dev` never exits.** Background it in every task that needs a browser.
- **Delete `web/.next/types` after removing the preview route** — a stale `validator.ts` makes `tsc` fail with `TS2307` and looks like a real type error.
- **Do not touch the payload.** If restyling seems to require changing what `runOptimize` sends, stop — it does not, and something has gone wrong.
- Responsive is stage 3c; the timetable grid is stage 4. If a task tempts you toward either, that is the other plan.
