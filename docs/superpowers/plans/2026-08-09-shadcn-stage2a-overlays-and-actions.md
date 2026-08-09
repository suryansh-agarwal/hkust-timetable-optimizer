# shadcn Adoption — Stage 2a: Overlays, Feedback and Actions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's hand-rolled toast, its two modal implementations and all thirteen buttons with shadcn components, deleting the bespoke ones.

**Branch:** all five tasks land on `feature/shadcn-stage2a`, cut from `master`. Create it before Task 1:

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer && git checkout -b feature/shadcn-stage2a
```

**Architecture:** Stage 1 installed shadcn and moved the theme onto its tokens; every surface is still inline-styled. This stage migrates the three families where a component library buys the most and the blast radius is smallest — feedback, overlays and actions — leaving form controls and surfaces to stage 2b. Each family is one task, and each ends with the bespoke implementation deleted rather than left beside its replacement.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui `base-nova` style over `@base-ui/react`, `sonner` for toasts, `next-themes`.

**Design spec:** `docs/superpowers/specs/2026-08-09-shadcn-redesign-design.md`

## Scope

Stage 2 in the spec covers eleven components across six files. That is too large for one reviewable plan, so it is split:

- **This plan (2a):** Button, Dialog, Sonner. Deletes `InfoModal.tsx` and `Toast.tsx`.
- **Stage 2b (separate plan, written when 2a lands):** Select, Checkbox, Input, Label, Card, Badge, Separator, Tooltip. That half is where the ~20 rendered `<select>` elements live.

## Global Constraints

- **`shadcn add` is destructive to same-named tokens.** Stage 1 established this the hard way: `init` silently replaced `--accent`, `--border` and `--font-sans`. After any CLI run, diff `web/app/globals.css` and revert unintended token changes before doing anything else.
- Migrated markup uses **Tailwind classNames**, not inline styles. Do not mix `style={{}}` and `className` on the same element.
- Never write a hex or named colour, in either form. Use tokens: `bg-primary`, `text-muted-foreground`, `border-border`.
- **Legacy aliases may only be deleted once every consumer is gone.** They are defined in `globals.css` and keep the remaining inline styles alive. Deleting one early makes a colour vanish silently — CSS resolves an unknown variable to an invalid value without erroring.
- Do not touch `web/app/components/TimetableGrid.tsx`. It is stage 4.
- Do not migrate `<select>`, `<input>`, `<checkbox>`, Card or Badge. Those are stage 2b.
- `web/proxy.ts` is the auth gate. If a task moves it aside for a preview route, it must be restored in the same task.
- Python backend untouched: `api/` stays at 74 passing tests.

---

### Task 1: Install the components and mount the toaster

**Files:**
- Create: `web/components/ui/dialog.tsx`, `web/components/ui/sonner.tsx`
- Modify: `web/components/ui/button.tsx` (regenerated), `web/app/layout.tsx`, `web/package.json`, `web/package-lock.json`
- Verify unchanged: `web/app/globals.css`

**Interfaces:**
- Consumes: the shadcn setup from stage 1 (`components.json`, `cn()` in `@/lib/utils`).
- Produces: `Button` with its `variant`/`size` props, `Dialog` and its parts, and `Toaster`. Tasks 2–4 import these from `@/components/ui/*`.

`button.tsx` already exists from stage 1's `init` and is unused. Re-adding it is harmless and keeps the set consistent — and `dialog.tsx` imports it (`<Button variant="ghost" size="icon-sm">` for the close affordance), so it must be present and current.

The generated files were checked with `--view` before this plan was written, so their contents are known rather than assumed: `dialog.tsx` exports `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogClose`, `DialogOverlay`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, and `sonner.tsx` exports `Toaster`. The registry's internal `IconPlaceholder` is rewritten to a real `lucide-react` icon by the CLI because `components.json` sets `"iconLibrary": "lucide"`.

- [ ] **Step 1: Record the current stylesheet so the CLI cannot change it unnoticed**

```bash
cd web && md5 -q app/globals.css
```

Note the value. Step 3 compares against it.

- [ ] **Step 2: Add the components**

```bash
cd web && npx shadcn@latest add button dialog sonner --yes --overwrite
```

`sonner` pulls the `sonner` package; the others need no new dependency because `@base-ui/react` is already installed.

Tooltip is deliberately not installed here. Nothing in this plan uses it, and an
unused generated component is just noise; it belongs with stage 2b, which
converts the `title` attributes still scattered across the buttons.

- [ ] **Step 3: Check whether the CLI touched the stylesheet**

```bash
cd web && md5 -q app/globals.css && git diff --stat app/globals.css
```

If the hash differs from Step 1, inspect the diff. Stage 1 proved the CLI rewrites tokens it recognises. Revert any change to `:root`, `.dark` or `@theme inline` with `git checkout -- app/globals.css`, then re-verify the hash matches. Do not accept a token change here on the assumption it is harmless.

- [ ] **Step 4: Mount the toaster**

`Toaster` must be inside `ThemeProvider`, because `sonner.tsx` calls `useTheme()` to pick its own light or dark styling. In `web/app/layout.tsx`, add the import:

```tsx
import { Toaster } from "@/components/ui/sonner";
```

and place it as the last child of `ThemeProvider`:

```tsx
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
```

- [ ] **Step 5: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: all clean, 17 vitest tests. Nothing visible changes yet — no toast is fired until Task 2.

- [ ] **Step 6: Commit**

```bash
git add web/components/ui web/app/layout.tsx web/package.json web/package-lock.json
git commit -m "chore(web): add button, dialog and sonner

Mounts Toaster inside ThemeProvider, which sonner.tsx requires because it
reads the resolved theme through useTheme. Nothing consumes these yet."
```

---

### Task 2: Replace the bespoke toast with Sonner

**Files:**
- Modify: `web/app/(app)/page.tsx`
- Delete: `web/app/components/Toast.tsx`

**Interfaces:**
- Consumes: `Toaster` mounted in Task 1.
- Produces: nothing downstream. Removes the `toastOpen` / `toastMessage` state.

The current toast is a fixed-position div rendered from `toastOpen` state, fired in exactly one place: when an optimize returns zero results.

- [ ] **Step 1: Find the three touch points**

```bash
cd web && grep -n "toastOpen\|toastMessage\|<Toast\|components/Toast" "app/(app)/page.tsx"
```

Expected: the `useState` declarations, a `setToastOpen(false)` reset inside `runOptimize`, the `setToastOpen(true)` when `resultCount === 0`, the `<Toast .../>` element near the top of the returned JSX, and the import.

- [ ] **Step 2: Swap the import**

Remove:

```tsx
import { Toast } from "../components/Toast";
```

Add:

```tsx
import { toast } from "sonner";
```

- [ ] **Step 3: Delete the state and the element**

Remove the `toastOpen` and `toastMessage` state declarations, and remove the whole `<Toast ... />` element from the JSX. Sonner renders through the `Toaster` mounted in the layout, so there is no element to place here.

- [ ] **Step 4: Fire the toast imperatively**

Inside `runOptimize`, remove the `setToastOpen(false)` reset near the top — Sonner does not need clearing. Then replace:

```tsx
      if (resultCount === 0) {
        setToastOpen(true);
      } else {
```

with:

```tsx
      if (resultCount === 0) {
        toast.error("Timetable not possible with current subjects");
      } else {
```

- [ ] **Step 5: Delete the bespoke component**

```bash
cd web && git rm app/components/Toast.tsx
```

- [ ] **Step 6: Verify no references survive**

```bash
cd web && grep -rn "Toast\b" app --include="*.tsx" | grep -v "sonner" || echo "  no references to the old Toast remain"
```

Expected: only the `Toaster` import in `layout.tsx`, if anything.

- [ ] **Step 7: Verify**

```bash
cd web && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 8: Commit**

```bash
git add "web/app/(app)/page.tsx" web/app/components/Toast.tsx
git commit -m "feat(web): replace the bespoke toast with sonner

The old Toast was a fixed div driven by two pieces of state for a single
call site. Sonner renders through the Toaster in the layout, so the state
goes away and the call becomes imperative."
```

---

### Task 3: Replace both modal implementations with Dialog

**Files:**
- Modify: `web/app/(app)/page.tsx`
- Delete: `web/app/components/InfoModal.tsx`

**Interfaces:**
- Consumes: `Dialog` from Task 1.
- Produces: nothing downstream. Removes `InfoIconButton`.

There are **two** separate modal implementations in this app, and both go:

1. `InfoModal`, used twice — the "Hard preferences" and "Soft preferences" explainers, opened by `InfoIconButton`.
2. An inline `<dialog>` element for the "How to use" help, gated on `showHelp`, with its own hand-rolled backdrop button.

The inline one is the reason `globals.css` carries a `dialog::backdrop` rule; that rule becomes dead and is removed in Task 5.

- [ ] **Step 1: Import Dialog and an icon**

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Info } from "lucide-react";
```

and remove:

```tsx
import { InfoIconButton, InfoModal } from "../components/InfoModal";
```

- [ ] **Step 2: Convert the two preference explainers**

Each currently appears as an `<InfoIconButton onClick={() => setOpenHardInfo(true)} />` next to a heading, with a matching `<InfoModal open={openHardInfo} ...>` further down holding the body copy.

Replace the pattern with a self-contained Dialog whose trigger sits inline, so the state variables disappear. For the hard-preferences one:

```tsx
                <Dialog>
                  <DialogTrigger
                    aria-label="About hard preferences"
                    className="inline-flex size-5 items-center justify-center rounded-full border border-border text-xs font-bold text-muted-foreground hover:bg-muted"
                  >
                    <Info className="size-3" aria-hidden />
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Hard preferences</DialogTitle>
                      <DialogDescription>
                        Hard preferences are non-negotiable constraints. If a timetable
                        violates one, it is rejected.
                      </DialogDescription>
                    </DialogHeader>
                    <ul className="ml-4 list-disc text-sm text-foreground">
                      <li>No classes before 10:30</li>
                      <li>Keep Friday completely free</li>
                      <li>Avoid clashes (required)</li>
                    </ul>
                  </DialogContent>
                </Dialog>
```

Do the same for soft preferences, with title "Soft preferences", description "Soft preferences are nice-to-haves. The optimiser will try to satisfy them, but may trade them off to find a feasible timetable.", and list items "Minimize gaps between classes", "Prefer compact schedules", "Prefer fewer days on campus".

Then delete the now-unused `openHardInfo` and `openSoftInfo` state and both old `<InfoModal>` blocks.

- [ ] **Step 3: Convert the help modal**

The help modal differs in one way that matters: it opens automatically on first render (`useState(true)`), and it is also opened by the "How to use?" header button. So it stays controlled rather than becoming a `DialogTrigger`.

Replace the entire `{showHelp && ( ... )}` block — the backdrop button, the `<dialog>`, and everything inside — with:

```tsx
      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>How to use</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm text-foreground">
            <section>
              <h3 className="font-bold">1) Choose a term</h3>
              <p>Pick “2026 Fall”, “2026 Summer” or “2026 Spring”. The label is just for clarity, but it loads the right term data behind the scenes.</p>
            </section>
            <section>
              <h3 className="font-bold">2) Add courses</h3>
              <p>Use the search box to find a course by code or title, then click “Add”. Selected courses show as chips you can remove.</p>
            </section>
            <section>
              <h3 className="font-bold">3) Set preferences</h3>
              <p><b>Hard</b> preferences are strict rules (e.g. “Must be free on Tue”). Any schedule that violates them is rejected.</p>
              <p><b>Soft</b> preferences are scored (e.g. “No classes after 5pm”). The optimizer tries to minimize these penalties.</p>
            </section>
            <section>
              <h3 className="font-bold">4) Optimize</h3>
              <p>Click “Optimize” to generate the best schedules. Each option shows a score and key tradeoffs. (it may take up to a minute to load the results)</p>
            </section>
            <section>
              <h3 className="font-bold">5) Compare results</h3>
              <p>Pin options you like, then select two to overlay and compare. This helps you choose between close tradeoffs.</p>
            </section>
            <section>
              <h3 className="font-bold">6) P.S.</h3>
              <p>This is a work in progress. Please report any issues or feedback to google form on the top right. Use the theme switch in the header to follow your system setting or force light or dark.</p>
            </section>
          </div>
        </DialogContent>
      </Dialog>
```

Keep the `showHelp` state and the header button's `onClick={() => setShowHelp(true)}` exactly as they are.

- [ ] **Step 4: Delete the bespoke component**

```bash
cd web && git rm app/components/InfoModal.tsx
```

- [ ] **Step 5: Verify nothing references it and no raw dialog survives**

```bash
cd web && grep -rn "InfoModal\|InfoIconButton\|<dialog" app --include="*.tsx" || echo "  clean"
```

Expected: no output.

- [ ] **Step 6: Verify**

```bash
cd web && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 7: Commit**

```bash
git add "web/app/(app)/page.tsx" web/app/components/InfoModal.tsx
git commit -m "feat(web): replace both modals with shadcn Dialog

Two implementations went: InfoModal, used for the preference explainers,
and a raw <dialog> with a hand-rolled backdrop for the help panel. The
explainers become self-contained Dialogs with inline triggers, dropping
two pieces of state; the help panel stays controlled because it opens on
first render. Base UI supplies the focus trap, escape handling and
scroll lock that the hand-rolled versions did not have."
```

---

### Task 4: Migrate every button

**Files:**
- Modify: `web/app/(app)/page.tsx`, `web/app/components/CoursePicker.tsx`, `web/app/login/page.tsx`, `web/app/request-access/page.tsx`, `web/components/theme-toggle.tsx`
- Modify: `web/app/globals.css` (remove `--primary-hover`)

**Interfaces:**
- Consumes: `Button` from Task 1.
- Produces: nothing downstream. Removes the `--primary-hover` token and every `onMouseEnter`/`onMouseLeave` hover handler.

Ten controls across four files — nine `<button>` elements and the Feedback `<a>` — plus the theme toggle's three, which one `.map()` renders. Thirteen in total.

`page.tsx` contains six `<button>` elements, but only four belong to this task: the help modal's backdrop button and its `×` close button are both deleted by Task 3, and `DialogContent` supplies a close affordance of its own. If either survives into this task, Task 3 was left incomplete — stop and say so rather than migrating them.

Every one currently hand-rolls its hover state with `onMouseEnter` / `onMouseLeave` handlers that mutate `style.background` directly, or with a `hoverX` boolean in state. `Button` handles hover, focus-visible, active and disabled through CSS, so all of that state and every handler goes.

`--primary-hover` is an invented token with no shadcn equivalent, introduced in stage 1 purely to serve those handlers. Once the handlers are gone it has no consumer, and stage 1's review flagged it for deletion here.

- [ ] **Step 1: Import Button in each file**

```tsx
import { Button } from "@/components/ui/button";
```

- [ ] **Step 2: Migrate the header actions in `page.tsx`**

The header row holds a Feedback link, a "How to use?" button and the Optimize button. Replace them with:

```tsx
          <Button
            variant="outline"
            size="sm"
            render={
              <a
                href="https://docs.google.com/forms/d/e/1FAIpQLSdUPWeLVqBYbBbZunz-tPnI3mvgGDgKN2onmYPKlZ13OcwNUA/viewform?usp=publish-editor"
                target="_blank"
                rel="noreferrer"
                aria-label="Leave feedback"
              />
            }
          >
            <MessageSquare className="size-4" aria-hidden />
            Feedback
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowHelp(true)}>
            How to use?
          </Button>
          <Button
            size="sm"
            onClick={runOptimize}
            disabled={loading || selectedCourses.length === 0}
          >
            {loading ? "Optimizing..." : "Optimize"}
          </Button>
```

Add `MessageSquare` to the lucide import. The inline `<svg>` speech-bubble currently used for Feedback is replaced by it.

`render` — **not** `asChild`. Base UI is not Radix and has no `asChild` prop; I
verified this by compiling both forms against the generated component:
`render={<a />}` typechecks, while `asChild` fails with
`TS2322: Type '{ children: Element; asChild: true; }' is not assignable`.
It makes Button render the anchor rather than wrapping it, so the link keeps
its semantics — a `<button>` wrapping an `<a>` breaks middle-click and
"open in new tab". `disabled` replaces the manual `opacity` and `cursor`
styling.

Verified available on this component: variants `default`, `outline`,
`secondary`, `ghost`, `destructive`, `link`; sizes `default`, `xs`, `sm`,
`lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg`.

- [ ] **Step 3: Migrate the remaining buttons**

Work through each remaining site and apply the same treatment: delete the `style={{}}` object, delete any `onMouseEnter`/`onMouseLeave` pair and the `hoverX` state they drove, and pick the variant by role.

| File | Button | Variant |
|---|---|---|
| `page.tsx` | Pin / Pinned on a result card | `variant={isPinned ? "secondary" : "outline"} size="sm"` |
| `page.tsx` | Unpin `×` in the pinned list | `variant="ghost" size="icon"` |
| `CoursePicker.tsx` | `+ Add` / `Added` in search results | `variant={on ? "secondary" : "outline"} size="sm"` |
| `CoursePicker.tsx` | Remove `×` on a selected course | `variant="ghost" size="icon"` |
| `login/page.tsx` | Continue with Google | default variant, `className="w-full"` |
| `login/page.tsx` | Continue with email | `variant="outline"`, `className="w-full"` |
| `request-access/page.tsx` | Copy email | `variant="outline"` |

For the two `×` buttons use `<X className="size-4" aria-hidden />` from lucide, so the accessible name survives the switch from a text glyph to an icon. `CoursePicker.tsx` already carries `aria-label={`Remove ${code}`}` — keep it. The unpin button in `page.tsx` has only `title="Unpin"`, which is a tooltip, not a name; give it `aria-label="Unpin"` as well. Once the `×` character is gone the button has no text content, so without a label it is unnamed to a screen reader.

- [ ] **Step 4: Migrate the theme toggle's three buttons**

In `web/components/theme-toggle.tsx`, replace each hand-styled `<button>` with:

```tsx
          <Button
            key={value}
            type="button"
            variant={active ? "default" : "ghost"}
            size="sm"
            onClick={() => setTheme(value)}
            aria-pressed={active}
            title={label}
            className="rounded-none"
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </Button>
```

Keep the `mounted` guard, the `role="group"` wrapper and its `aria-label` exactly as they are — the guard prevents a hydration mismatch and is still required. Convert the wrapper's inline styles to `className="inline-flex overflow-hidden rounded-lg border border-border bg-card"`.

- [ ] **Step 5: Remove the dead token**

Confirm nothing references it, then delete both definitions:

```bash
cd web && grep -rn "primary-hover" app components || echo "  no consumers remain"
```

Expected: only the two definitions in `globals.css`. Remove the `--primary-hover` line from both the `:root` and `.dark` blocks.

- [ ] **Step 6: Verify no hover handlers or button style objects survive**

```bash
cd web && grep -rn "onMouseEnter\|onMouseLeave" app components --include="*.tsx" || echo "  no hover handlers remain"
cd web && grep -rn "hoverPrimary\|hoverEmail\|setHoverPrimary\|setHoverEmail" app --include="*.tsx" || echo "  no hover state remains"
```

Expected: no output from either. If a hover handler survives on a non-button element, leave it and say so in the report — this task only covers buttons.

- [ ] **Step 7: Confirm every token still resolves**

Removing a token is exactly the risk the alias block exists to guard against:

```bash
cd web && comm -23 \
  <(grep -rhoE "var\(--[a-z0-9-]+" app components --include="*.tsx" | sed 's/var(//' | sort -u) \
  <(grep -oE "^[[:space:]]*--[a-z0-9-]+[[:space:]]*:" app/globals.css | sed 's/[[:space:]]//g; s/:$//' | sort -u)
```

Expected: no output.

- [ ] **Step 8: Verify**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

- [ ] **Step 9: Commit**

```bash
git add "web/app/(app)/page.tsx" web/app/components/CoursePicker.tsx web/app/login/page.tsx web/app/request-access/page.tsx web/components/theme-toggle.tsx web/app/globals.css
git commit -m "feat(web): migrate every button to shadcn Button

Thirteen controls across five files. Each hand-rolled its hover state with
onMouseEnter/onMouseLeave handlers mutating style.background, or with a
boolean in state; Button does hover, focus-visible, active and disabled
in CSS, so the handlers and their state are gone.

Removes --primary-hover, an invented non-shadcn token that existed only
to feed those handlers."
```

---

### Task 5: Clean up and verify

**Files:**
- Modify: `web/app/globals.css` (remove the dead `dialog::backdrop` rule)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Remove the dead backdrop rule**

Task 3 deleted the last raw `<dialog>`, so this rule in `globals.css` styles nothing:

```css
dialog::backdrop {
  background: var(--overlay);
}
```

Confirm first, then delete it:

```bash
cd web && grep -rn "<dialog" app components --include="*.tsx" || echo "  no dialog elements remain - rule is dead"
```

Leave `--overlay` itself defined; stage 2b and later stages may still use it.

- [ ] **Step 2: Full gate**

```bash
cd api && .venv/bin/pytest tests/ -q
cd ../web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: 74 Python tests, 17 vitest, everything clean, no deprecation warnings.

- [ ] **Step 3: Confirm no colour literals were introduced**

```bash
cd /Users/suryanshagarwal/Desktop/projects/hkust-timetable-optimizer
git diff master...HEAD -- web/app web/components | grep "^+" | grep -oE '#[0-9a-fA-F]{3,8}\b|"white"|"crimson"' | sort -u || echo "  none"
```

- [ ] **Step 4: Confirm the deleted components are really gone**

```bash
cd web && ls app/components/
```

Expected: `CoursePicker.tsx` and `TimetableGrid.tsx` only. `InfoModal.tsx` and `Toast.tsx` must be absent.

- [ ] **Step 5: Confirm auth still gates**

Task 1 modified the root layout, where the Toaster mounts.

Start the dev server as a **background** process — `next dev` never returns, and running it in the foreground will hang the task:

```bash
cd web && npx next dev --port 3000
```

Then, once it reports ready:

```bash
for p in "/" "/login" "/request-access"; do
  printf "  %-18s " "$p"
  curl -s -o /dev/null -w "HTTP %{http_code} -> %{redirect_url}\n" "http://localhost:3000$p"
done
```

Expected: `/` gives 307 to `/login?next=%2F`; the other two give 200.

- [ ] **Step 6: Exercise the migrated surfaces in a browser**

Keep the dev server on port 3000 — the API's CORS allowlist contains only that origin. Start the API from `api/` (also in the background) with `MINICATALOG_PATH="../web/public/course-index/{term}.json"`. Create `web/app/preview-tmp/page.tsx` rendering `Home` from `../(app)/page`, and take the auth gate out of the way with `rm web/proxy.ts` — deleting rather than renaming, so Step 7's `git checkout` restores it. Do not commit while it is missing.

Check, in both themes:

1. The help dialog opens on load, closes on Escape, and reopens from "How to use?".
2. Focus is trapped inside the dialog while open, and returns to the trigger on close — this is the behaviour the hand-rolled version lacked.
3. Both preference explainer dialogs open from their info triggers.
4. Optimizing with an impossible hard constraint raises a Sonner toast, and it dismisses itself.
5. Buttons show a visible focus ring on keyboard navigation, and the Optimize button is properly disabled with no courses selected.
6. The theme toggle still switches and still shows the active option.

- [ ] **Step 7: Clean up the preview scaffolding**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts 2>/dev/null; git status --short
```

Expected: clean apart from the repo's pre-existing untracked `kite-export.mp4`. **Verify `web/proxy.ts` exists** — a missing proxy silently disables authentication.

- [ ] **Step 8: Commit**

```bash
git add web/app/globals.css
git commit -m "chore(web): drop the dead dialog::backdrop rule

The last raw <dialog> went with the help modal; Base UI's Dialog renders
its own overlay. --overlay stays defined for later stages."
```

---

## Notes for the implementer

- **Treat every `shadcn add` as destructive to `globals.css`.** Stage 1 learned this: `init` replaced `--accent` with a pale grey, replaced `--border`, and turned a working `--font-sans` into a circular reference. Task 1 hashes the file before and after for exactly this reason.
- **Do not delete a legacy alias whose consumers still exist.** An undefined CSS variable fails silently; the colour simply disappears and nothing errors. `--primary-hover` is safe to remove in Task 4 only because that task removes its last consumer in the same commit.
- **Use `render`, never `asChild`.** `asChild` is a Radix API; this project is on Base UI and it does not compile. Verified against the generated component.
- The `mounted` guard in `theme-toggle.tsx` is load-bearing and must survive Task 4. The server cannot know the resolved theme.
- Stage 2b covers Select, Checkbox, Input, Label, Card, Badge and Separator. If a task here tempts you into a `<select>`, stop — that is the other plan.
