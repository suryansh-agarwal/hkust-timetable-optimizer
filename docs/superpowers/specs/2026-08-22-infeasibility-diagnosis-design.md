# Telling a student why no timetable was possible — Design

## Problem

When `/optimize/ranked` returns nothing, the app shows a toast:

> Timetable not possible with current subjects/sections

That message is a guess. "Zero results" has three distinct causes and the
toast conflates them, so in two of the three cases it points the student at
the wrong input.

**Cause 1 — the search found nothing.** Every course survives its own locks
and pins, but the surviving options clash across courses. `api/main.py:258`
already catches the easy version of this: if a lock leaves one course with
*zero* bundles on its own, the API returns `ok: false` with
`"COMP 2011 has no sections matching Prof. Chan"`. What it does not catch is
two courses each retaining one option, at the same time. Nothing is
individually blocked, so the search runs and returns an empty pool.

**Cause 2 — schedules exist, and every one was rejected.** `api/main.py:298`
drops any schedule whose `score_schedule` breakdown carries `rejected`, which
hard free days and hard time cutoffs set. So a student whose hard rule is
"no classes after 15:00" against a required 16:30 lecture gets told the
problem is their *subjects and sections*. It is not, and nothing they do to
their course list will help. The comment directly above that filter records a
past bug in this exact spot, where the same students were instead handed six
schedules that all violated the rule.

**Cause 3 — the courses simply cannot coexist**, with no locks involved. Same
empty pool as cause 1, different remedy: drop a course rather than a lock.

There is also a delivery problem. The one case the backend diagnoses well
arrives as `ok: false` and renders in a **persistent error panel**
(`PreferencesPanel.tsx:304`, `whitespace-pre-wrap`). The cases it does not
diagnose arrive as `ok: true` with an empty list and get a **toast that
disappears**. The better-explained failure is the one that stays on screen.

## Goal

When the optimiser returns nothing, say which of the student's inputs made it
impossible, and deliver it the same way `blocked_by_lock` already is.

## Design

### Where the diagnosis happens

In `api/main.py`, at the two points that already know something went wrong:
after `pool` is built, and after `scored` is filtered. Both currently fall
through to a success response with an empty `results` list.

Neither diagnosis runs on the happy path. They are only reached when the
answer is already "nothing", so they cost nothing in the normal case.

### Cause 1 and 3 — an empty pool

Diagnose by **pairwise mutual exclusion**: for each pair of courses, test
whether every bundle of A conflicts with every bundle of B. `bundle_conflicts`
(`optimizer_bundles.py:14`) already does the per-pair work and is reused
as-is.

If such a pair exists, it is a complete and minimal explanation — those two
courses cannot both be scheduled, whatever else is chosen. Name them, and name
the locks in play if either course has one, because that is the difference
between "drop a course" and "drop a lock".

If no pair is mutually exclusive, the infeasibility is higher-order: three or
more courses that pair up fine but cannot all coexist. Say that honestly
rather than inventing a culprit. A minimal unsatisfiable subset would name it
exactly; that is deliberately out of scope, because in a five-course timetable
the pairwise case is the common one and MUS is materially more machinery.

Cost is `O(n² × bA × bB)` on a handful of courses with a handful of bundles
each — negligible, and only on a path that has already failed.

### Cause 2 — a non-empty pool, filtered to nothing

No search required. Every rejected schedule already carries its reason:
`score_schedule` appends `hard_free_day_violation` (with `day`),
`hard_no_after_violation` and `hard_no_before_violation` (with `day` and
`cutoff`) before returning `REJECTED_SCORE`.

Collect those across the rejected pool and report the rules that rejected
**every** schedule — those are the ones that must be relaxed. A rule that
rejected only some schedules is not the blocker and must not be named, or the
message sends the student to change something that was not the problem.

Report how many schedules existed before the filter. "Sixteen timetables fit
your courses, but all sixteen break a hard rule" tells the student their
course selection is fine, which is the single most useful fact in this case.

### Response shape

Both diagnoses return the shape `blocked_by_lock` already uses, so the
frontend needs no new branch — `ok: false` with an `error` string is already
routed to the persistent panel:

```json
{ "ok": false, "error": "...", "infeasible_because": "clash" | "hard_preferences" | "unknown", ... }
```

The extra key is for the frontend to act on later if it wants to (highlighting
the offending control, say). It is not required for this feature to work.

### Message wording

The panel is `whitespace-pre-wrap`, so a message may use line breaks. Each
message states what happened, then what to change. Examples:

```
No timetable is possible: COMP 2011 and MATH 1014 cannot both be scheduled.
Every remaining option for COMP 2011 (locked to Prof. Chan) clashes with
every remaining option for MATH 1014 (locked to L1).
```

```
16 timetables fit your courses, but every one breaks a hard preference:
no classes after 15:00 on Friday.
Relax that rule, or make it a soft preference, to see them.
```

Exact strings belong in the implementation plan, not here; what this spec
fixes is that a message names a specific input and a specific remedy.

### What happens to the toast

Once both diagnoses land, `ok: true` with zero results should be unreachable.
The toast branch stays as a defensive fallback — a future path that returns an
empty list without a diagnosis should show *something* rather than nothing —
with a comment saying the backend is expected to have returned `ok: false`.
Its wording is unchanged; it is the project owner's.

## Explicitly out of scope

- **Minimal unsatisfiable subsets.** Higher-order infeasibility gets an honest
  "these courses cannot all coexist" rather than a named pair.
- **Suggesting a fix automatically** — which lock to drop, which rule to
  relax. Naming the constraint is the deliverable; choosing for the student is
  a different feature.
- **Frontend changes beyond the toast comment.** The persistent panel already
  renders `ok: false` errors; this feature routes into it rather than
  rebuilding it.

## A known adjacent risk, not addressed here

`find_bundle_schedules` stops once it has `max_solutions`, so a *successful*
search exits early — but a failing one explores the entire space before
returning empty. With enough courses and bundles that is a large number of
combinations, and the diagnosis added here runs only *after* that search has
already completed. This feature does not make it worse, and does not fix it.
Worth a cap and a "gave up" state if it ever bites.

## Verification

- `api/` gains tests for both diagnoses, driven through `score_schedule` and
  `find_bundle_schedules` rather than mocks: a two-course fixture whose locks
  leave one clashing option each, and a fixture whose schedules all violate one
  hard cutoff. The Python suite goes from 74.
- A pair that is *not* mutually exclusive must not be reported. The test that
  matters most is the one asserting a partial conflict stays silent.
- A hard rule that rejects only some schedules must not be named.
- Existing behaviour unchanged: `blocked_by_lock` still fires for the
  single-course case and still takes precedence, and a successful optimise is
  byte-identical in its response shape.
- Web suite stays at 59 and `next build` stays clean; the only frontend change
  is a comment.
