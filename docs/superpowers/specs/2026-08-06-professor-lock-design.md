# Professor Lock — Design

## Problem

Students frequently care who teaches a course, not just when it meets. A course
like COMP 1023 runs five lecture sections under three different lecturers, and a
student with a preference has no way to express it. Today the optimiser treats
every section of a course as interchangeable apart from its meeting times, so it
will happily return a schedule built around a lecturer the student was trying to
avoid.

The instructor is already scraped (`wcq_parser.py` reads the Instructor column
into `Section.instructor`) and already returned by `/optimize/ranked` on every
part, but nothing in the frontend reads it and nothing in the solver acts on it.

## Goal

Let a student pin a specific course to a specific professor, as a hard
constraint: the optimiser may only build schedules from that professor's
sections of that course. One professor per course, chosen independently per
course.

## Data findings that shaped this design

Measured against the live 2610 catalogue (1,404 courses, all 96 subjects):

| Section type | Total | Listed as `TBA` |
|---|---|---|
| Lectures | 222 | 4 (2%) |
| Tutorials | 245 | 26 (11%) |
| Labs | 39 | 36 (92%) |

(Section-type counts are from the COMP/ECON/MATH sample; course counts below are
from the full catalogue.)

Four facts drive the decisions:

1. **Labs are nearly always `TBA`.** Every COMP lab in 2610 is unassigned. A
   filter that required every section to name the professor would delete all
   labs and make the course unschedulable the moment a lock was applied.
2. **Tutorials usually do name the professor.** ECON 2103 lists `LI, Xuan` on
   T1/T2 and `KELLER, Wolfgang` on T3, so tutorials cannot be blanket-exempt
   either — locking to Keller should yield Keller's tutorial.
3. **Multi-instructor cells exist and have no delimiter.** MATH 4992 L1 reads
   `'KU, Yin Bon LEUNG, Shing Yu'` — two people, space-joined.
4. **Only 70 of 1,404 courses have more than one distinct lecturer.** For the
   other 95% there is nothing to choose. 1,146 courses have at least one named
   instructor; 258 have none at all.

## Matching rule

A single pure function decides eligibility:

```
section_allows(section_instructor, lock):
    if section_instructor is None or "" or "TBA":   -> True
    return normalise(lock) in normalise(section_instructor)

normalise(s) = collapse internal whitespace, uppercase, strip
```

Two deliberate choices:

**Unnamed sections stay eligible.** This is what keeps COMP's `TBA` labs
available while still pinning the lecture, and it is why the rule is stated as
"named-or-TBA" rather than "must match".

**Substring, not equality.** This handles the multi-instructor cells: a lock of
`KU, Yin Bon` matches `KU, Yin Bon LEUNG, Shing Yu`. Since the dropdown offers
the raw cell text as one entry, a combined entry also matches itself.

**The lock must additionally be satisfiable.** Because `section_allows` lets
unnamed sections through, a course can retain sections while the locked
professor teaches none of them — every lecture filtered out, only `TBA` labs
left. `build_bundles` has an early return for courses with no lectures that
would then emit lab-only bundles, scheduling a course with no lecture at all.
A second predicate guards this:

```
lock_is_satisfiable(instructors, lock):
    at least one instructor is named AND contains the lock
```

If it fails, the course yields no bundles and the request is reported as
blocked. This was found while writing the implementation plan, not during
design.

Worked examples:

```
COMP 2011, lock = "LI, Xin"
  LEC L1   LI, Xin        kept
  LEC L2   CHAN, ...      dropped
  LAB LA1  TBA            kept      <- lab survives
  LAB LA2  TBA            kept

ECON 2103, lock = "KELLER, Wolfgang"
  LEC L1   LI, Xuan       dropped
  LEC L3   KELLER         kept
  TUT T1   LI, Xuan       dropped
  TUT T3   KELLER         kept      <- correct tutorial
```

## Architecture

### Where the professor list comes from

The dropdown is populated from the **static course index**
(`web/public/course-index/<term>.json`), not from a live API call.

The index only ever populates the dropdown. Filtering runs server-side against
freshly-scraped section data, so staleness degrades safely: if a professor
changes after an index rebuild, a stale lock filters to zero sections and the
student sees a specific error rather than a silently wrong timetable.

Cost, measured: the 2610 index grows from 165,490 to 209,446 bytes (+26.6%). It
is fetched once per term and cached in a module-level `Map`.

### Index build — `scripts/build_course_index.py`

`process_subject_data` collects the distinct non-`TBA` instructor strings for a
course, preserving section order, and writes them as `entry["instructors"]`.
The field is omitted entirely when a course has no named instructor.

Older term indexes (2530, 2540) will not have the field until rebuilt. The UI
treats a missing field as "no professor data" and hides the control.

### Backend

New module `api/instructor_filter.py` holding `normalise` and `section_allows`.
It has no dependencies beyond the standard library and is the single place the
rule is expressed.

`bundles.py::build_bundles` gains an optional `instructor_lock: str | None`
parameter and filters `course.sections` through `section_allows` before
splitting them into LEC/TUT/LAB. Everything downstream — matching rules,
cartesian pairing, dedupe — is unchanged and composes correctly: locking
ECON 2103 to Keller leaves L3, and the existing `matching_type: "tutorial"`
rule then pins T3.

Because the filter runs on `course.sections` before they are categorised, it
applies uniformly to every section type, including the uncategorised `OTH`
sections that `build_bundles` treats as standalone bundles. There is no
per-type exemption: the named-or-`TBA` rule is the only thing that decides
eligibility.

Filtering before bundling (rather than penalising in `scoring.py`) is what makes
this a genuine hard constraint. It prunes the search space instead of competing
with other preferences, and it cannot be traded away by the scorer.

`main.py` adds to `OptimizeRankedRequest`:

```python
instructor_locks: Dict[str, str] = Field(default_factory=dict)
```

Keyed by course code. An absent key means unconstrained, so the field is
backward-compatible with existing clients.

Scope: `/optimize/ranked` only. `/optimize/bundles` and `/optimize/basic` are
unchanged — the UI does not call them.

### Frontend

`CourseIndexEntry` in `web/lib/api.ts` gains `instructors?: string[]`.

`page.tsx` holds `instructorLocks: Record<string, string>` alongside
`selectedCourses`, persisted on the same debounce. Keys for deselected courses
are pruned before the payload is sent.

`CoursePicker` renders a professor `<select>` beneath each selected-course chip:
"Any professor" plus the names. Courses with exactly one name render it
disabled — informational rather than interactive.

### Schema

One additive migration, creating `supabase/migrations/` in this repo:

```sql
alter table public.user_course_selections
  add column instructor_locks jsonb not null default '{}'::jsonb;
```

Because it is additive with a default, existing rows and the current `upsert`
(which does not list columns explicitly) keep working untouched. Locks are
naturally per-term: the table's primary key is already `(user_id, term)`.

## Error handling

If a lock leaves a course with zero bundles, `/optimize/ranked` returns:

```json
{
  "ok": false,
  "error": "No sections of COMP 2011 are taught by LI, Xin.",
  "blocked_by_instructor_lock": ["COMP 2011"]
}
```

This is deliberately distinct from a generic no-solution response, because the
remedy differs: the student should drop the lock, not the course. The frontend
surfaces it through the existing error path.

## Testing

`api/` has no test framework today; this adds pytest as a dev dependency.

`instructor_filter` — the rule is small, pure, and the place where a subtle
mistake silently produces wrong timetables:

- `None`, `""`, `"TBA"`, and `"tba"` all remain eligible
- case and whitespace normalisation (`"li,  xin"` matches `"LI, Xin"`)
- multi-instructor substring (`"KU, Yin Bon"` matches
  `"KU, Yin Bon LEUNG, Shing Yu"`)
- a non-matching name is rejected

`build_bundles` with a lock:

- lectures are filtered to the locked professor
- `TBA` labs are retained
- a lock matching nothing yields zero bundles

## Limitations

- Multi-instructor cells are offered as a single combined entry. There is no
  reliable delimiter to split `'KU, Yin Bon LEUNG, Shing Yu'` into two names.
- The dropdown is only meaningful for the 70 multi-lecturer courses; the
  remaining ~1,076 named courses show one fixed name.
- A name that goes stale between index rebuilds fails at optimize time rather
  than being caught in the picker.

## Explicitly out of scope

- Multiple professors per course ("either A or B")
- Professor avoidance (exclude rather than require)
- Searching or filtering the course picker by professor
- Soft professor preference; this is a hard constraint only
