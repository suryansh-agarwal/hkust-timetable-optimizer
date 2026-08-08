# Section Lock — Design

## Problem

The professor lock shipped in `6bf408d` lets a student pin a course to a
professor. It does not let them say which *section* they want. When one
professor teaches several lecture sections — COMP 1023 has `TSOI, Yau Chat`
on both L1 and L2 — locking the professor still leaves the optimiser free to
pick either, and a student who wants the 10:30 lecture has no way to say so.

Measured against the live 2610 catalogue, section pinning is meaningful for
substantially more courses than professor pinning. All figures below share one
base: the **1,254 courses that have at least one LEC, TUT or LAB section**.

| Constraint | Courses where it changes anything |
|---|---|
| Professor lock (shipped) | 69 — more than one distinct lecturer |
| Lecture pin | **173** — more than one lecture section |
| Tutorial pin | **129** — several tutorials, no matching rule to determine them |
| Lab pin | 51 — more than one lab section |
| (Tutorial, matching enforced) | 31 — pinning the lecture already constrains these |

An earlier note in this project quoted 70 for the professor figure; that came
from a different denominator (all index entries, including courses with no
sections). On the base above it is 69.

## Goal

Let a student pin a specific section per component type — one lecture, one
tutorial, one lab — for each course, as a hard constraint. Where the course
enforces lecture/tutorial or lecture/lab matching, the UI must reflect that
structure rather than letting the student construct an invalid combination.

## Decisions

Four choices were made during brainstorming and are settled:

1. **One pin per component type**, not one per course. A student can pin a
   lecture and a tutorial independently.
2. **Professor locking moves inside the lecture control.** That control
   offers Any / a professor / a specific lecture. Tutorial and lab controls
   are section-only.
3. **Section data is fetched on demand**, not baked into the static index.
   Embedding 3,097 sections would take the index from 210 KB to 411 KB
   (+96%) for every visitor, and section times go stale between rebuilds in a
   way instructor names do not — a wrong time is invisible until the student
   shows up to an empty room.
4. **Matching narrows, then the student chooses.** See below.

## The narrowing rule

Matching constrains the *numeric group*, not the individual section. This is
the detail that shapes the UI, and it was initially misunderstood:

```
MATH 1003, matching_type "tutorial"
  L1 -> T1A, T1B, T1C, T1D      four valid tutorials, not one
  L2 -> T2A, T2B, T2C, T2D
```

Across the 2610 catalogue, of the lecture→tutorial pairs on matched courses,
**59 groups have exactly one member and 41 have several**. So "pinning L1
auto-selects T1" is correct only 59% of the time.

The rule:

- When a **specific lecture** is pinned on a matched course, the tutorial
  control offers only tutorials whose group equals the pinned lecture's group.
  - Exactly one candidate → auto-select it and **disable** the control.
  - Several candidates → leave the control **enabled**, offering only those.
- Changing the pinned lecture re-narrows, and clears an existing tutorial pin
  that is no longer in the narrowed set.
- `matching_type: "both"` applies the same narrowing to labs.
- Choosing a **professor** rather than a lecture does **not** narrow. A
  professor may teach lectures in several groups, so there is no single group
  to narrow to.

## Data model

A second column alongside the shipped one, rather than reshaping it. No data
migration, and the professor feature keeps working untouched.

```sql
alter table public.user_course_selections
  add column section_locks jsonb not null default '{}'::jsonb;
```

```json
instructor_locks  {"COMP 1023": "TSOI, Yau Chat"}
section_locks     {"MATH 1003": {"lecture": "L1", "tutorial": "T1B"},
                   "COMP 2011": {"lecture": "L2"}}
```

Every key inside a course entry is optional. `instructor_locks` and a
`lecture` pin for the same course are mutually exclusive in the UI, because
one control produces one or the other. The API does not enforce that: if both
arrive, both are applied, which is a narrower constraint and cannot produce a
wrong schedule — only an empty one.

## New endpoint

`GET /course/sections?term=&course_code=`

```json
{
  "course_code": "MATH 1003",
  "matching_required": true,
  "matching_type": "tutorial",
  "sections": [
    {
      "section": "L1",
      "type": "LEC",
      "group": "1",
      "instructor": "WU, Yueping",
      "meetings": [{"day": "Mo", "start": "09:00", "end": "09:50"}]
    }
  ]
}
```

Roughly 2 KB per course. It reuses the existing `_load_courses_with_cache`
path, so it hits the same 20-minute scrape cache the optimiser uses.

`type` and `group` are computed server-side using `section_utils.section_type`
and the same numeric extraction `bundles.section_num` already uses. The
frontend must not re-derive them: two copies of the section-numbering rule
would drift, and the matching semantics depend on them agreeing.

`matching_required` and `matching_type` come from the mini-catalog, the same
source the optimiser consults, so the UI narrows on exactly the rule the
backend will enforce.

## Backend filtering

`build_bundles` gains `section_lock: dict | None`:

```python
build_bundles(course, constraint=None, instructor_lock=None, section_lock=None)
```

A section stays eligible when it passes the existing instructor rule **and**,
if a pin exists for its component type, equals that pin. Component types with
no pin are unconstrained.

Everything downstream already exists. The component-emptied guard added during
the professor lock's final review means a pin naming a section that no longer
exists empties that bucket and returns `[]`, producing a clear error rather
than a schedule missing a required class. Matching composes for free: pinning
L1 leaves `lecs=[L1]`, and the existing strict-matching code narrows tutorials
to group 1 by itself.

`OptimizeRankedRequest` gains:

```python
section_locks: Dict[str, Dict[str, str]] = Field(default_factory=dict)
```

Absent means unconstrained, so existing clients are unaffected.

## Error handling

`blocked_by_instructor_lock` becomes `blocked_by_lock`, since a block can now
originate from either kind of constraint. This is a breaking change to a field
shipped in `6bf408d`, but the only consumer is this repo's frontend, updated
in the same change. The frontend's guard already triggers on `ok === false`
generally, so the key is informational.

The error message must name the specific pin that failed — "no section L4 of
COMP 1023" reads very differently from "no schedule possible".

## Frontend

State becomes `sectionLocks: Record<string, {lecture?: string; tutorial?: string; lab?: string}>`,
persisted on the same debounce as `courses` and `instructorLocks`, and pruned
when a course is deselected.

Section data is fetched per course on selection and cached by
`(term, course_code)`. While a fetch is in flight the controls render disabled
with a loading label; on failure they render disabled with the error, and the
course simply carries no pins.

Controls render only for component types the course actually has. A course
with no tutorials shows no tutorial control.

## Testing

Backend, extending the existing 28-test suite in `api/tests/`:

- a lecture pin filters lectures to that section and leaves labs untouched
- a tutorial pin filters tutorials only
- a pin naming a non-existent section yields no bundles
- a lecture pin plus a conflicting tutorial pin on a matched course yields no
  bundles
- a lecture pin on a matched course still admits every tutorial in its group
- absent `section_locks` is byte-identical in behaviour to before
- the endpoint returns correct `type` and `group` for `L1`, `T1A`, `LA1`

The narrowing logic is the highest-risk part and lives in the frontend, which
has no test runner. Adding one is out of scope for this feature; the plan must
instead specify these four manual checks explicitly, each naming a real course:

1. **Single-candidate auto-select** — a matched course whose lecture group has
   one tutorial: pinning the lecture selects that tutorial and disables the
   control.
2. **Multi-candidate narrowing** — MATH 1003: pinning L1 leaves the tutorial
   control enabled offering exactly T1A–T1D, and no T2x.
3. **Re-narrowing** — switching MATH 1003 from L1 to L2 replaces the options
   with T2A–T2D.
4. **Invalidation** — with L1 and T1B pinned, switching to L2 clears the T1B
   pin rather than leaving an impossible combination that only fails at
   optimise time.

## Limitations

- Narrowing depends on the mini-catalog's `matching_required` flag. A course
  whose matching requirement is not detected by the parser will offer
  unnarrowed tutorials; the backend still rejects an invalid combination, so
  the failure is loud rather than wrong.
- Pins are stored by section code. If HKUST renumbers sections between
  sessions, a stored pin stops matching and the student gets a block they must
  clear manually.
- Fetching per course means a course picker with many courses issues several
  small requests. They are cached per term for the session.

## Explicitly out of scope

- Professor avoidance, and multi-select of any kind
- Pinning by time of day rather than by section
- Narrowing tutorials when a professor rather than a lecture is chosen
- Any change to `/optimize/bundles` or `/optimize/basic`
