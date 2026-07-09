# Gap Shape Preference — Design

## Problem

The scoring engine (`api/scoring.py::gaps_penalty`) currently sums idle minutes
between classes on the same day and penalizes that sum linearly
(`-total_gap_minutes * weights.gaps_per_min`). This means a single 3-hour gap
and three separate 1-hour gaps (same total idle time) score identically, even
though users have real, opposite preferences here: some want one long
consolidated break, others prefer several shorter breaks and dislike one huge
dead block. There is currently no way to express or act on that preference.

## Goal

Let the user pick one of three gap-shape preferences, and make the scorer
rank schedules accordingly:

- **No preference** — behave exactly as today (linear sum of gap minutes).
- **Prefer one long gap** — penalize fragmenting a day's free time into
  several smaller gaps more than keeping it as one consolidated block.
- **Prefer several short gaps** — penalize one long dead block more than
  splitting the same total time into shorter breaks.

This preference replaces the existing `compact_days` boolean entirely (per
user decision — see Open Questions Resolved below). The Low/Med/High
`gaps_per_min` weight preset is unaffected and continues to scale the overall
size of the penalty; the shape preference only changes how the *raw* penalty
value is computed before that weight is applied.

## Core Formula

For each day, instead of `Σ gap_i`, compute a generalized power mean:

```
day_penalty = ( Σ gap_i ^ p ) ^ (1 / p)
```

where `gap_i` are the idle-minute gaps between consecutive classes on that
day (same definition as today — gap = next.start_min − prev.end_min, only
counted when positive), and `p` is chosen by the selected shape:

| Preference               | `p`  | Effect |
|---------------------------|------|--------|
| No preference              | 1.0  | Reduces to `Σ gap_i` — identical to current behavior |
| Prefer one long gap (consolidated) | 0.5  | Concave — splitting into more gaps costs *more* than one big one |
| Prefer several short gaps (fragmented) | 2.0  | Convex — one big gap costs *more* than several small ones |

Total penalty = sum of `day_penalty` across all days with meetings, exactly
as the current function sums across days. The final score contribution is
unchanged: `-total_penalty * weights.gaps_per_min`.

**Why the power-mean (raise-then-root) instead of a raw `Σ gap_i ^ p`:** the
power-mean keeps the result in minutes-scale regardless of `p`. A raw
`Σ gap_i ^ p` would blow up in magnitude for `p=2` (e.g. one 180-min gap →
32,400) and shrink for `p=0.5` (one 180-min gap → 13.4), breaking the
existing weight calibration and making the shape term either dominate or
vanish relative to every other scoring term (free-day bonuses, cutoff
penalties, etc., which sit in the tens-to-low-hundreds range). The
power-mean, by construction, returns exactly `180` for a single 180-minute
gap under *any* `p` — only the relative cost of splitting that gap changes.

**Worked example** (from the approved design):

```
gaps = [180]  vs  [60, 60, 60]   (same total = 180 minutes)

p=1   (no preference):  180        vs  180        → tied (today's behavior)
p=0.5 (prefer 1 long):  13.4^(1/0.5)=180  vs  (3×60^0.5)^(1/0.5)=540  → fragmented costs more
p=2   (prefer short):   (180^2)^0.5=180   vs  (3×60^2)^0.5=103.9      → consolidated costs more
```

## Open Questions Resolved (from brainstorming)

1. **Relation to existing `compact_days` checkbox and weight preset**: the
   3-way shape selector *replaces* `compact_days` entirely. The Low/Med/High
   `gaps_per_min` weight preset is untouched and keeps scaling the result.
2. **Penalty math**: power-curve/power-mean approach (above), not a flat
   per-gap surcharge with a hand-picked threshold.
3. **"No preference" semantics**: always applies the linear per-minute cost
   (today's default-on behavior) — there is no longer a way to fully disable
   gap penalties. This is an intentional behavior change: previously
   unchecking "compact days" zeroed out gap penalties entirely; going
   forward, gaps always cost something proportional to their length, and the
   only tunable axis is the *shape* bias on top of that.

## Backend Changes (`api/`)

### `main.py`

- `Preferences.compact_days: bool = False` is removed.
- New field: `Preferences.gap_shape: Literal["no_preference", "consolidated", "fragmented"] = "no_preference"`.
- No other request/response shape changes.

### `scoring.py`

- `gaps_penalty(meetings)` → `gaps_penalty(meetings, shape: str) -> float`.
  - Internal constant: `GAP_SHAPE_EXPONENTS = {"no_preference": 1.0, "consolidated": 0.5, "fragmented": 2.0}`.
  - Per day: collect positive gaps as today; if no gaps, contribute 0; else compute `(sum(g ** p for g in gaps)) ** (1 / p)`.
  - Sum across days, return as before (now a float instead of an int, since non-integer exponents produce non-integer results).
- `score_schedule`:
  - Remove the `if prefs.compact_days:` guard around the gaps block — the
    penalty is now always computed (mirroring how every other preference
    field already works, e.g. `soft_free_days`, `soft_no_after`).
  - Call `gaps_penalty(ms, prefs.gap_shape)`.
  - Breakdown entry keeps type `"gaps_minutes"`, keeps `"minutes"` (now the
    shape-adjusted value, not necessarily an integer) and `"value"`, and
    gains a new `"shape": prefs.gap_shape` key for debugging/display.

No changes to `optimizer_basic.py` or `optimizer_bundles.py` — this is purely
a scoring-stage change; the solver's search order and pruning are untouched.

## Frontend Changes (`web/`)

### `lib/api.ts`

- `Prefs.compact_days?: boolean` → `Prefs.gap_shape?: "no_preference" | "consolidated" | "fragmented"`.

### `app/(app)/page.tsx`

- Remove `compactDays` state and its checkbox (currently `:320` and `:816-819`).
- Add `gapShape` state, default `"no_preference"`.
- Add a `<select>` in the "Weights & style" section, styled identically to
  the existing Gap-penalty/Early-late-penalty `<select>`s (`:784-807`), with
  three options:
  - `"no_preference"` → "No preference"
  - `"consolidated"` → "Prefer one long gap"
  - `"fragmented"` → "Prefer several short gaps"
- `runOptimize()`'s `prefs` object (`:422-436`) sends `gap_shape: gapShape`
  instead of `compact_days: compactDays`.
- Breakdown-label helper (currently reads `b.type === "compact_days"` around
  `:196`) is updated to key off the renamed/still-present `"gaps_minutes"`
  breakdown type and, optionally, mention the active shape in the label.

## Testing

This project has no pytest suite; `api/scripts/sanity_prefs.py` is a
hand-rolled assert-based sanity script run directly
(`python scripts/sanity_prefs.py`). Add to it:

1. **Regression parity**: the existing 30-minute-gap case
   (`test_gaps_penalty_with_weights`) is updated to pass `gap_shape="no_preference"`
   and must still assert the identical `-3.0` penalty value — proving `p=1`
   is byte-for-byte equivalent to today's linear formula.
2. **Consolidated preference ordering**: build two schedules with the same
   total idle minutes on a day — one as a single long gap, one as several
   shorter gaps — and assert the single-gap schedule scores *higher*
   (less negative) under `gap_shape="consolidated"`.
3. **Fragmented preference ordering**: same two schedules, assert the
   multi-gap schedule scores higher under `gap_shape="fragmented"`.
4. **Zero-gap edge case**: back-to-back classes (gap = 0) contribute 0
   penalty under all three shapes.

## Out of Scope

- No change to the solver/backtracking algorithm (`optimizer_bundles.py`,
  `optimizer_basic.py`).
- No change to hard/soft free-day or cutoff-time preferences.
- No backward-compatibility shim for old `compact_days` clients — the
  frontend is updated in the same change, and this is a personal-use app
  with no external API consumers.
