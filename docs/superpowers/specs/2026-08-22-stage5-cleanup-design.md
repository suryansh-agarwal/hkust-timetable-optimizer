# Stage 5 — Cleanup — Design

## Problem

The four-stage shadcn adoption is finished and merged. Each stage deliberately
pushed a small number of findings forward rather than widening its own diff, and
those are recorded at the end of
`docs/superpowers/specs/2026-08-09-shadcn-redesign-design.md` under "Carried into
stage 4" and "Carried beyond stage 4".

Most of that list is tidy-up that can wait indefinitely. Five items are not:
three are defects a user can see, one is a correctness trap that has already
caused two shipped commits to target numbers that were not what rendered, and
one is a structural risk that grows with every future edit. This stage takes
those, plus one copy fix, and leaves the rest recorded.

## Goal

Close the carried findings that are defects rather than preferences, and remove
the duplication that made four separate stage-4 tasks edit the same block twice
each.

## Scope

Six items, in the order they should land.

### 1. Extract `<GridBlock>`

`TimetableGrid` and `CompareTimetableGrid` still render the block closure
verbatim twice. Stage 1 of the previous stage extracted the *chrome* around it
and deliberately left this larger duplicate alone.

It has not drifted — stage 4's final review diffed the two closures and found
every surviving difference to be behavioural. But that held because four tasks
were each reviewed against both copies. It is not a property of the code; it is
a property of how carefully the reviews were run, and it will not survive a
stage that is less careful.

`GridBlock` takes the colours, the label, the detail level and the geometry,
plus an optional slot for the compare grid's `opacity`, `zIndex` and focus
handlers — the only things that genuinely differ.

**This goes first.** Every later item in this stage that touches a block then
lands in one place instead of two, and this is the change most likely to
surprise, so it should happen while the branch is otherwise empty.

### 2. The focus ring is overpainted by the next lane

The main grid sets no `z-index` on its blocks, and the focus outline — 2px at
2px offset, so 4px outward — exceeds the 3px half-gap between lanes. With two or
more overlapping classes in a day, the outer ~1px of a focused block's ring is
covered by the block in the next lane.

The compare grid is already immune by accident: `onFocus` sets `hoveredSide`,
which sets `zIndex: 10`.

`focus-visible:z-10` on the block fixes it, and doubles as the structural
guarantee the ring currently lacks — nothing today stops a future ancestor
`overflow` change from clipping it silently.

### 3. The mobile first paint flashes both preference panels open

`PreferencesPanel` renders `defaultOpen={true}` because the server has no
viewport, then a `useEffect` reads `matchMedia` and a `key` change remounts the
Collapsible closed. On a phone that means roughly thirty controls appear and
vanish on every load, with the layout shift that follows.

The effect cannot move earlier. Reading the viewport during render is a
hydration mismatch, which is precisely why it is in an effect, and the
`eslint-disable` above it says so.

**So do not fix the effect — stop the paint.** Apply `max-lg:hidden` to both
`CollapsibleContent`s while un-hydrated, cleared by the same effect that already
runs. Below `lg` the content is never painted; at `lg` and above the class does
not apply, so desktop is untouched. `CollapsibleContent` passes through to Base
UI's `Panel`, which accepts `className`, so no new mechanism is needed and the
`defaultOpen`/key trick stays exactly as it is.

`useSyncExternalStore` was considered and rejected: it would remove the
`eslint-disable` but not the flash, because the server snapshot is still a fixed
value.

**Accepted cost, stated plainly:** with JavaScript disabled, a phone would render
the panels unreachable rather than open and readable. The optimiser cannot do
anything without JavaScript, so this narrows a page that is already
non-functional — but it is a real narrowing and should not be discovered later
as a surprise.

### 4. The preferences panel is a scroll container on both axes

`PreferencesPanel`'s root is `max-h-[520px] overflow-y-auto`. CSS computes the
other axis to `auto` when one is not `visible`, so the panel scrolls
horizontally too.

That matters beyond the panel. The page-level
`document.scrollWidth === clientWidth` check that three stage-3c tasks relied on
cannot see anything overflowing inside it — the same is true of
`CoursePicker`'s `max-h-80 overflow-auto`. Nothing overflows today; the widest
mobile row measures about 223px. The check is simply weaker than it was trusted
to be.

`max-h-none lg:max-h-[520px]` drops the cap below `lg`, where stacking already
made the panel full-width and roughly twice as tall, so a nested touch scroller
inside the page scroller is now the normal case rather than an edge one.

### 5. `page.tsx`'s `mb-3` and `mt-1` do not render what they say

Both are flex children of a `p-5` Card, and flex gaps add to margins rather than
collapsing, so they render 28px and 20px rather than 12px and 4px. `mb-3` is not
a step on the scale at all.

This is the exact trap stage 3c's Task 2 existed to close; these two were
outside every task's declared file list and survived. Two shipped commits have
now targeted numbers that were not what rendered, which is what makes this
worth fixing rather than noting.

### 6. The impossible-timetable message names the wrong cause

`web/app/(app)/page.tsx:286` fires
`toast.error("Timetable not possible with current subjects")` when an optimise
returns nothing.

Since section locking shipped, that is frequently untrue: an impossible result
is often caused by a pinned lecture or tutorial, not by the subject list. The
message sends a student to remove a course when the fix is to clear a pin.

New string, verbatim:

> `Timetable is not possible with current subjects/sections`

Note this also adds "is", which the current string lacks.

## Explicitly out of scope

Two carried items are design decisions rather than defects, and stay recorded
until they get an explicit answer:

- **A 15-minute meeting overlaps the block below it by 6px**, because the
  `Math.max(22, …)` floor exceeds its natural 16px. Raising the floor to 32 was
  tried during stage 4 and rejected — it widened the overlap to 16px. A real fix
  has to shrink what a floor-height block renders, or let very short blocks
  shift rather than grow. That is a visual judgment, not a cleanup.
- **About twenty `size="sm"` select triggers are 28px tall.** Stage 3c raised
  four buttons to 44px below `lg`; these are the same question at five times the
  count, on the controls a phone user touches most. Changing them all reshapes
  the preferences panel on mobile and needs a decision about how tall that panel
  is allowed to become.

Everything else in the two carried lists — the unused `endMin` in `TimeAxis`'s
prop type, `FILL_ALPHA` hardcoded in the contrast test, the static inline values
on the block wrapper and the chrome, the duplicated `startHour`/`endHour` props,
`hiddenUntilFound` for find-in-page, the redundant `ease-in-out` — is real but
costs nothing to carry, and none of it is worth a branch of its own.

## Verification

Per the standing rules: `npx tsc --noEmit`, `npx eslint .` at exactly its two
pre-existing problems, `npx vitest run`, `npx next build` clean with
`ƒ Proxy (Middleware)` present, and `api/` untouched at 74 passing tests.

Specific to this stage, and measured rather than asserted:

- **Item 1 must not change the render.** A screenshot diff of both grids, both
  themes, before and after — the same proof stage 4's extraction produced.
- **Item 2**: focus a block in a day with two overlapping classes and confirm the
  ring is unclipped on all four sides.
- **Item 3**: load at 375px on a cold navigation and confirm no frame paints the
  panel contents. A single screenshot cannot show this; capture during load, or
  assert on the class before and after hydration.
- **Item 4**: confirm the panel no longer scrolls horizontally below `lg`, and
  that the page still does not overflow at 375px.
- **Item 5**: measure the rendered margins, not the class names. The whole point
  is that the two disagree.

## Risks

- **Item 1 is the only structural change**, and it moves code that four stage-4
  tasks and two fix rounds converged on. It ships first and alone so a
  regression is bisectable to one commit.
- **Item 3 changes first-paint behaviour**, which is the hardest thing in this
  stage to verify and the easiest to believe is fixed. The verification above is
  a requirement, not a nicety.
