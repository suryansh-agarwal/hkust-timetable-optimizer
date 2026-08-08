# Professor Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student pin a course to a specific professor as a hard constraint, so the optimiser only builds schedules from that professor's sections of that course.

**Architecture:** One pure module (`api/instructor_filter.py`) owns the matching rule. `bundles.py` applies it to a course's sections before bundles are built, which makes it a hard constraint that prunes the search space rather than a score the optimiser can trade away. The professor names shown in the picker come from the static course index; the actual filtering always runs server-side against freshly-scraped section data.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 / pytest (new) on the backend. Next.js 16 / React 19 / TypeScript with inline styles on the frontend. Supabase Postgres for persistence.

**Design spec:** `docs/superpowers/specs/2026-08-06-professor-lock-design.md`

## Global Constraints

- The matching rule is **named-or-TBA**: a section is eligible if its instructor is `None`, `""`, or `"TBA"`, **or** if the normalised lock string is a substring of the normalised instructor string.
- `normalise(s)` = collapse internal whitespace, strip, uppercase. Nothing else.
- The set of values treated as unnamed is exactly `{"", "TBA"}` after normalisation. Do not add `STAFF`, `TBD`, or any other value — they were not observed in the catalogue and inventing them would silently widen every lock.
- Substring matching, never equality — multi-instructor cells like `"KU, Yin Bon LEUNG, Shing Yu"` have no delimiter.
- One professor per course. No multi-select, no avoidance, no soft preference.
- Only `/optimize/ranked` gains the feature. `/optimize/bundles` and `/optimize/basic` are untouched.
- `instructor_locks` is optional everywhere it appears; an absent key means unconstrained, so existing clients keep working.
- Do not add pytest to `api/requirements.txt` — Render installs that file in production. Use `api/requirements-dev.txt`.
- Existing code style: `api/` uses flat imports (`from models import ...`), not package-relative. Match it.
- Frontend uses inline styles with CSS variable tokens from `web/app/globals.css`. Never write a hex literal — use `var(--token)`.

---

### Task 1: Add the `instructor_locks` column

**Files:**
- Create: `supabase/migrations/20260808120000_add_instructor_locks.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `public.user_course_selections.instructor_locks` — `jsonb NOT NULL DEFAULT '{}'::jsonb`. Task 6 reads and writes it.

The table today is `user_course_selections(user_id uuid, term text, courses text[], updated_at timestamptz)` with primary key `(user_id, term)` and RLS enabled. This migration is additive with a default, so existing rows and the current `upsert` (which does not name columns explicitly) keep working untouched.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260808120000_add_instructor_locks.sql`. This is the first migration in the repo, so the directory is new.

```sql
-- Per-course professor locks, keyed by course code:
--   {"COMP 2011": "LI, Xin", "ECON 2103": "KELLER, Wolfgang"}
-- Additive with a default so existing rows and the current upsert keep working.
alter table public.user_course_selections
  add column if not exists instructor_locks jsonb not null default '{}'::jsonb;
```

- [ ] **Step 2: Apply it to the project**

Apply to Supabase project `fjivsrronriyawdtyrvr` using the `apply_migration` MCP tool with name `add_instructor_locks` and the SQL above.

- [ ] **Step 3: Verify the column exists**

Run `list_tables` for schema `public` with `verbose: true`.
Expected: `public.user_course_selections` lists an `instructor_locks` column of type `jsonb` with default `'{}'::jsonb`.

- [ ] **Step 4: Verify existing rows survived**

Run `execute_sql`:

```sql
select user_id, term, courses, instructor_locks from public.user_course_selections;
```

Expected: every existing row still has its `courses` intact and `instructor_locks` equal to `{}`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260808120000_add_instructor_locks.sql
git commit -m "feat(db): add instructor_locks to user_course_selections"
```

---

### Task 2: The matching rule and its tests

**Files:**
- Create: `api/instructor_filter.py`
- Create: `api/tests/test_instructor_filter.py`
- Create: `api/pytest.ini`
- Create: `api/requirements-dev.txt`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalise(value: Optional[str]) -> str`
  - `is_unnamed(instructor: Optional[str]) -> bool`
  - `section_allows(section_instructor: Optional[str], lock: Optional[str]) -> bool`
  - `lock_is_satisfiable(instructors: Iterable[Optional[str]], lock: Optional[str]) -> bool`
  - `collect_instructors(sections: Iterable[dict]) -> list[str]`

  Task 3 uses `collect_instructors`. Task 4 uses `section_allows` and `lock_is_satisfiable`.

`collect_instructors` lives here rather than in the build script because it shares the definition of "unnamed" with `section_allows`. Those two must agree: a name excluded from the picker must be a name the filter treats as unconstrained.

- [ ] **Step 1: Set up pytest**

Create `api/requirements-dev.txt`:

```
-r requirements.txt
pytest
```

Create `api/pytest.ini` so tests can use the same flat imports as the app code:

```ini
[pytest]
pythonpath = .
testpaths = tests
```

Install into the existing venv:

```bash
cd api && .venv/bin/pip install -r requirements-dev.txt
```

- [ ] **Step 2: Write the failing tests**

Create `api/tests/test_instructor_filter.py`:

```python
from instructor_filter import (
    collect_instructors,
    is_unnamed,
    lock_is_satisfiable,
    normalise,
    section_allows,
)


def test_normalise_collapses_whitespace_and_uppercases():
    assert normalise("  li,   xin ") == "LI, XIN"
    assert normalise(None) == ""


def test_unnamed_values():
    for value in (None, "", "   ", "TBA", "tba", " Tba "):
        assert is_unnamed(value) is True
    assert is_unnamed("LI, Xin") is False


def test_unnamed_sections_are_always_allowed():
    # 92% of labs in 2610 are TBA; a lock must not delete them.
    for value in (None, "", "TBA", "tba"):
        assert section_allows(value, "LI, Xin") is True


def test_name_matches_ignoring_case_and_whitespace():
    assert section_allows("LI, Xin", "li,  xin") is True


def test_multi_instructor_cell_matches_either_name():
    # MATH 4992 L1 is literally this string - two people, no delimiter.
    cell = "KU, Yin Bon LEUNG, Shing Yu"
    assert section_allows(cell, "KU, Yin Bon") is True
    assert section_allows(cell, "LEUNG, Shing Yu") is True
    assert section_allows(cell, cell) is True


def test_different_professor_is_rejected():
    assert section_allows("CHAN, Cecia Ki", "LI, Xin") is False


def test_absent_lock_allows_every_section():
    assert section_allows("CHAN, Cecia Ki", None) is True
    assert section_allows("CHAN, Cecia Ki", "") is True


def test_lock_is_satisfiable_requires_a_named_match():
    # Only TBA sections surviving does not satisfy the lock.
    assert lock_is_satisfiable(["TBA", None], "LI, Xin") is False
    assert lock_is_satisfiable(["TBA", "LI, Xin"], "LI, Xin") is True


def test_absent_lock_is_always_satisfiable():
    assert lock_is_satisfiable(["TBA"], None) is True


def test_collect_instructors_dedupes_preserving_order():
    sections = [
        {"section": "L1", "instructor": "TSOI, Yau Chat"},
        {"section": "L2", "instructor": "TSOI, Yau Chat"},
        {"section": "L3", "instructor": "LAM, Ngok"},
        {"section": "LA1", "instructor": "TBA"},
        {"section": "LA2", "instructor": None},
    ]
    assert collect_instructors(sections) == ["TSOI, Yau Chat", "LAM, Ngok"]


def test_collect_instructors_returns_empty_when_all_unnamed():
    assert collect_instructors([{"section": "LA1", "instructor": "TBA"}]) == []
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd api && .venv/bin/pytest tests/test_instructor_filter.py -v
```

Expected: collection error, `ModuleNotFoundError: No module named 'instructor_filter'`.

- [ ] **Step 4: Write the implementation**

Create `api/instructor_filter.py`:

```python
"""Instructor matching for professor locks.

Two concerns live together here because both hinge on the same definition of
an unnamed instructor: which names the picker offers, and which sections a
lock permits. If they disagreed, a name hidden from the picker could still be
the only thing a lock matched.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

# Exactly the values observed as placeholders in the WCQ catalogue. Widening
# this set would silently make more sections eligible for every lock.
UNNAMED = {"", "TBA"}


def normalise(value: Optional[str]) -> str:
    """Collapse whitespace, strip, uppercase. Returns "" for None."""
    if not value:
        return ""
    return " ".join(str(value).split()).upper()


def is_unnamed(instructor: Optional[str]) -> bool:
    """True when a section names nobody, so no lock should exclude it."""
    return normalise(instructor) in UNNAMED


def section_allows(section_instructor: Optional[str], lock: Optional[str]) -> bool:
    """
    Named-or-TBA: a section is eligible when it names nobody, or when the lock
    appears within its instructor text.

    Substring rather than equality, because WCQ joins co-instructors with no
    delimiter: "KU, Yin Bon LEUNG, Shing Yu".
    """
    if not lock:
        return True
    if is_unnamed(section_instructor):
        return True
    return normalise(lock) in normalise(section_instructor)


def lock_is_satisfiable(instructors: Iterable[Optional[str]], lock: Optional[str]) -> bool:
    """
    True when at least one section actually names the locked professor.

    section_allows lets TBA sections through, so a course can retain sections
    while the professor teaches none of them. That case must be rejected rather
    than silently scheduling a course the student never asked for.
    """
    if not lock:
        return True
    needle = normalise(lock)
    return any(
        not is_unnamed(value) and needle in normalise(value) for value in instructors
    )


def collect_instructors(sections: Iterable[dict[str, Any]]) -> list[str]:
    """Distinct named instructors for a course, in section order, TBA omitted."""
    found: list[str] = []
    for section in sections:
        instructor = section.get("instructor")
        if is_unnamed(instructor):
            continue
        cleaned = " ".join(str(instructor).split())
        if cleaned not in found:
            found.append(cleaned)
    return found
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd api && .venv/bin/pytest tests/test_instructor_filter.py -v
```

Expected: 11 passed.

- [ ] **Step 6: Commit**

```bash
git add api/instructor_filter.py api/tests/test_instructor_filter.py api/pytest.ini api/requirements-dev.txt
git commit -m "feat(api): add instructor matching rule with tests"
```

---

### Task 3: Collect instructors into the course index

**Files:**
- Modify: `scripts/build_course_index.py` (imports at top; `process_subject_data`)
- Modify: `web/public/course-index/2610.json` (regenerated)

**Interfaces:**
- Consumes: `collect_instructors` from Task 2.
- Produces: index entries gain an optional `"instructors": ["NAME", ...]` key, omitted when a course has no named instructor. Task 6 reads it.

The script talks to the API over HTTP and currently imports nothing from `api/`, so it needs a `sys.path` entry to reach the shared rule. Duplicating the logic instead would let the picker and the filter drift apart.

- [ ] **Step 1: Add the import**

In `scripts/build_course_index.py`, after the existing `import httpx` line, add:

```python
# The picker's names and the optimiser's filter must agree on what counts as
# an unnamed instructor, so both use api/instructor_filter.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from instructor_filter import collect_instructors  # noqa: E402
```

`sys` and `Path` are already imported at the top of the file.

- [ ] **Step 2: Populate the field**

In `process_subject_data`, the entry is currently built as:

```python
            entry = {
                "course_code": code,
                "title": c.get("title", ""),
                "units": c.get("units"),
                "subject": subject,
            }
```

Immediately after that block, and before the `if matching_required:` block, insert:

```python
            # Names shown in the professor picker. Omitted when every section
            # is TBA, so the UI can hide the control entirely.
            instructors = collect_instructors(c.get("sections") or [])
            if instructors:
                entry["instructors"] = instructors
```

- [ ] **Step 3: Regenerate the 2610 index**

The scraper caches subject HTML for 20 minutes, so clear it first to avoid indexing a stale copy:

```bash
rm -rf api/.cache_wcq/2610
cd api && MINICATALOG_PATH="../web/public/course-index/{term}.json" \
  .venv/bin/python -m uvicorn main:app --port 8000
```

In a second terminal (this takes roughly 7 minutes for 96 subjects):

```bash
api/.venv/bin/python scripts/build_course_index.py \
  --term 2610 --api-base http://127.0.0.1:8000 \
  --out web/public/course-index/2610.json
```

- [ ] **Step 4: Verify the regenerated index**

```bash
python3 -c "
import json
d = json.load(open('web/public/course-index/2610.json'))
withi = [c for c in d if c.get('instructors')]
multi = [c for c in d if len(c.get('instructors') or []) > 1]
print('courses:', len(d))
print('with instructors:', len(withi))
print('with 2+ names:', len(multi))
# A narrow range, not an equality: HKUST adds and withdraws courses during
# the term so the exact count drifts, but a partial scrape must still fail
# loudly. Pair this with the builder's own '0 subjects failed' summary.
assert 1390 < len(d) < 1450, 'course count outside the expected range'
assert 1100 < len(withi) < 1200, 'unexpected named-instructor count'
sample = next(c for c in d if c['course_code'] == 'COMP 1023')
print('COMP 1023:', sample['instructors'])
assert 'TBA' not in sample['instructors']
print('OK')
"
```

Expected: 1404 courses, roughly 1146 with instructors, and COMP 1023 listing its distinct lecturers with no `TBA`.

- [ ] **Step 5: Commit**

```bash
git add scripts/build_course_index.py web/public/course-index/2610.json
git commit -m "feat: collect instructor names into the course index"
```

---

### Task 4: Apply the lock when building bundles

**Files:**
- Modify: `api/bundles.py` (imports; `build_bundles`)
- Create: `api/tests/test_bundles_instructor_lock.py`

**Interfaces:**
- Consumes: `section_allows`, `lock_is_satisfiable` from Task 2.
- Produces: `build_bundles(course, constraint=None, instructor_lock=None) -> List[Bundle]`. Task 5 calls it with the third argument.

There is a trap here. `build_bundles` has an early return, `if not lecs: return [Bundle(course.course_code, [s]) for s in sections]`, meant for courses with no lectures. If a lock removed every lecture but left TBA labs, that branch would fire and return lab-only bundles — scheduling the course with no lecture at all. `lock_is_satisfiable` guards against it: if no surviving section actually names the professor, the course has no valid bundles.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_bundles_instructor_lock.py`:

```python
from bundles import MatchingConstraint, build_bundles
from models import Course, Section


def make_course(sections):
    return Course(
        course_code="COMP 2011",
        title="Programming with C++",
        units=4,
        sections=[
            Section(section=name, class_no=idx + 1, instructor=instructor)
            for idx, (name, instructor) in enumerate(sections)
        ],
    )


def sections_in(bundles):
    return {part.section for bundle in bundles for part in bundle.parts}


def test_no_lock_keeps_every_lecture():
    course = make_course([
        ("L1", "LI, Xin"),
        ("L2", "CHAN, Cecia Ki"),
        ("LA1", "TBA"),
    ])
    assert sections_in(build_bundles(course)) == {"L1", "L2", "LA1"}


def test_lock_filters_lectures_but_keeps_tba_labs():
    course = make_course([
        ("L1", "LI, Xin"),
        ("L2", "CHAN, Cecia Ki"),
        ("LA1", "TBA"),
        ("LA2", "TBA"),
    ])
    bundles = build_bundles(course, MatchingConstraint(), instructor_lock="LI, Xin")
    found = sections_in(bundles)
    assert "L1" in found
    assert "L2" not in found
    # Labs are unassigned; dropping them would make the course unschedulable.
    assert {"LA1", "LA2"} <= found


def test_lock_keeps_matching_tutorial_and_drops_the_other():
    course = make_course([
        ("L1", "LI, Xuan"),
        ("L3", "KELLER, Wolfgang"),
        ("T1", "LI, Xuan"),
        ("T3", "KELLER, Wolfgang"),
    ])
    bundles = build_bundles(course, MatchingConstraint(), instructor_lock="KELLER, Wolfgang")
    found = sections_in(bundles)
    assert found == {"L3", "T3"}


def test_lock_naming_nobody_yields_no_bundles():
    course = make_course([
        ("L1", "LI, Xin"),
        ("LA1", "TBA"),
    ])
    assert build_bundles(course, MatchingConstraint(), instructor_lock="NOBODY, Real") == []


def test_lock_matching_only_tba_sections_yields_no_bundles():
    # Guards the "no lectures left" early return: TBA labs alone must not
    # become a valid schedule for the course.
    course = make_course([
        ("L1", "CHAN, Cecia Ki"),
        ("LA1", "TBA"),
        ("LA2", "TBA"),
    ])
    assert build_bundles(course, MatchingConstraint(), instructor_lock="LI, Xin") == []
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd api && .venv/bin/pytest tests/test_bundles_instructor_lock.py -v
```

Expected: failures — `build_bundles()` takes no `instructor_lock` keyword argument.

- [ ] **Step 3: Add the filter**

In `api/bundles.py`, add to the imports:

```python
from instructor_filter import lock_is_satisfiable, section_allows
```

Change the signature and add the filter at the top of the body. The function currently begins:

```python
def build_bundles(
    course: Course,
    constraint: Optional[MatchingConstraint] = None
) -> List[Bundle]:
```

Replace with:

```python
def build_bundles(
    course: Course,
    constraint: Optional[MatchingConstraint] = None,
    instructor_lock: Optional[str] = None,
) -> List[Bundle]:
```

Then, immediately after the docstring and before `lecs, tuts, labs, oth = [], [], [], []`, insert:

```python
    # A lock must be satisfied by a section that actually names the professor.
    # section_allows lets TBA sections through, so without this check a course
    # whose lectures were all filtered out could still produce lab-only
    # bundles via the "no lectures" early return below.
    if not lock_is_satisfiable((s.instructor for s in course.sections), instructor_lock):
        return []

    sections = [s for s in course.sections if section_allows(s.instructor, instructor_lock)]
```

- [ ] **Step 4: Use the filtered list throughout**

`build_bundles` reads `course.sections` in three places. Replace all three with the local `sections`:

1. The classification loop, `for s in course.sections:` becomes `for s in sections:`
2. `if not lecs and not tuts and not labs:` returns `[Bundle(course.course_code, [s]) for s in course.sections]` — becomes `for s in sections`
3. `if not lecs:` returns `[Bundle(course.course_code, [s]) for s in course.sections]` — becomes `for s in sections`

Leave every other line of the function alone. The matching-constraint logic, cartesian pairing, and dedupe all operate on the classified lists and need no changes.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd api && .venv/bin/pytest tests/ -v
```

Expected: all tests pass, including Task 2's.

- [ ] **Step 6: Commit**

```bash
git add api/bundles.py api/tests/test_bundles_instructor_lock.py
git commit -m "feat(api): filter sections by instructor lock when building bundles"
```

---

### Task 5: Accept locks in the optimize endpoint

**Files:**
- Modify: `api/main.py` (`OptimizeRankedRequest`; `optimize_ranked`)
- Create: `api/tests/test_optimize_instructor_locks.py`

**Interfaces:**
- Consumes: `build_bundles(..., instructor_lock=...)` from Task 4.
- Produces: `POST /optimize/ranked` accepts `instructor_locks: Dict[str, str]`. On an unsatisfiable lock it returns `{"ok": false, "error": str, "blocked_by_instructor_lock": [course_code, ...]}`. Task 7 sends the field and reads the error.

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_optimize_instructor_locks.py`. This uses FastAPI's test client against the real app but stubs the catalogue loading, so it needs no network.

```python
import pytest
from fastapi.testclient import TestClient

import main
from models import Course, Section


@pytest.fixture
def client(monkeypatch):
    course = Course(
        course_code="COMP 2011",
        title="Programming with C++",
        units=4,
        sections=[
            Section(section="L1", class_no=1, instructor="LI, Xin"),
            Section(section="L2", class_no=2, instructor="CHAN, Cecia Ki"),
            Section(section="LA1", class_no=3, instructor="TBA"),
        ],
    )

    monkeypatch.setattr(
        main, "_load_courses_with_cache", lambda *a, **k: ({"COMP 2011": course}, [], [])
    )
    monkeypatch.setattr(main, "load_mini_catalog", lambda term: {})
    return TestClient(main.app)


def post(client, **overrides):
    body = {"term": "2610", "course_codes": ["COMP 2011"], "max_solutions": 5, "prefs": {}}
    body.update(overrides)
    return client.post("/optimize/ranked", json=body).json()


def test_absent_locks_field_still_works(client):
    data = post(client)
    assert data["ok"] is True


def test_lock_restricts_results_to_that_professor(client):
    data = post(client, instructor_locks={"COMP 2011": "LI, Xin"})
    assert data["ok"] is True
    chosen = {
        part["section"]
        for result in data["results"]
        for course in result["schedule"]
        for part in course["parts"]
    }
    assert "L2" not in chosen
    assert "L1" in chosen


def test_unsatisfiable_lock_reports_the_course_and_professor(client):
    data = post(client, instructor_locks={"COMP 2011": "NOBODY, Real"})
    assert data["ok"] is False
    assert data["blocked_by_instructor_lock"] == ["COMP 2011"]
    assert "COMP 2011" in data["error"]
    assert "NOBODY, Real" in data["error"]
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd api && .venv/bin/pytest tests/test_optimize_instructor_locks.py -v
```

Expected: `test_unsatisfiable_lock_reports_the_course_and_professor` fails with `KeyError: 'blocked_by_instructor_lock'`, and the restriction test fails because L2 still appears.

If `fastapi.testclient` raises about a missing `httpx` extra, install it: `.venv/bin/pip install "httpx" "fastapi[standard]"` — `httpx` is already a dependency, so this should not be needed.

- [ ] **Step 3: Add the request field**

In `api/main.py`, `OptimizeRankedRequest` currently ends with `prefs: Preferences = Preferences()`. Add above it:

```python
    # Course code -> professor. Absent key means the course is unconstrained.
    instructor_locks: Dict[str, str] = Field(default_factory=dict)
```

- [ ] **Step 4: Apply locks and report failures**

In `optimize_ranked`, the loop that builds choices currently reads:

```python
    choices = []
    for cc in req.course_codes:
        course = course_map[cc]
        constraint = _get_matching_constraint(
            mini_catalog,
            cc,
            missing_catalog_entries,
            used_matching_rules,
        )
        bundles = build_bundles(course, constraint)
        choices.append(BundleChoice(course_code=cc, bundles=[b.parts for b in bundles]))
```

Replace with:

```python
    choices = []
    blocked_by_lock: list[str] = []
    for cc in req.course_codes:
        course = course_map[cc]
        constraint = _get_matching_constraint(
            mini_catalog,
            cc,
            missing_catalog_entries,
            used_matching_rules,
        )
        lock = req.instructor_locks.get(cc)
        bundles = build_bundles(course, constraint, instructor_lock=lock)
        if not bundles and lock:
            blocked_by_lock.append(cc)
        choices.append(BundleChoice(course_code=cc, bundles=[b.parts for b in bundles]))

    # Distinct from a generic no-solution: the fix is to drop the lock, not the
    # course, so say which lock and which course.
    if blocked_by_lock:
        details = ", ".join(
            f"{cc} has no sections taught by {req.instructor_locks[cc]}"
            for cc in blocked_by_lock
        )
        return {
            "ok": False,
            "error": f"No schedule is possible: {details}.",
            "blocked_by_instructor_lock": blocked_by_lock,
            "subjects_fetched": subjects_fetched,
            "cache_misses": cache_misses,
        }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd api && .venv/bin/pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add api/main.py api/tests/test_optimize_instructor_locks.py
git commit -m "feat(api): accept instructor_locks in /optimize/ranked"
```

---

### Task 6: Professor picker, state, and persistence

**Files:**
- Modify: `web/lib/api.ts` (`CourseIndexEntry`; add `getCourseFromIndex`; `optimizeRanked`)
- Modify: `web/app/components/CoursePicker.tsx` (props; selected-course list)
- Modify: `web/app/(app)/page.tsx` (state; load effect; save effect; `runOptimize`; `CoursePicker` usage)

This is one task rather than two because adding required props to
`CoursePicker` breaks the typecheck until `page.tsx` supplies them. Split
across two commits the intermediate state would not build, so there would be
nothing a reviewer could independently approve.

**Interfaces:**
- Consumes: the `instructors` field from Task 3.
- Produces:
  - `CourseIndexEntry.instructors?: string[]`
  - `getCourseFromIndex(term: string, courseCode: string): CourseIndexEntry | undefined`
  - `optimizeRanked(term, course_codes, prefs, max_solutions, instructor_locks)` — fifth parameter, defaults to `{}`
  - `CoursePicker` props gain `locks: Record<string, string>` and `setLocks: (locks: Record<string, string>) => void`

  Nothing downstream consumes these; Task 7 only verifies them.

- [ ] **Step 1: Extend the index type and add a lookup**

In `web/lib/api.ts`, add to `CourseIndexEntry`:

```ts
  // Distinct named instructors, in section order. Absent when all sections are TBA.
  instructors?: string[];
```

Then add below `searchCourseIndex`:

```ts
/**
 * Look up a single course in the cached index. Returns undefined if the index
 * has not loaded yet, so callers must tolerate a missing entry.
 */
export function getCourseFromIndex(
  term: string,
  courseCode: string
): CourseIndexEntry | undefined {
  return indexCache.get(term)?.find((e) => e.course_code === courseCode);
}
```

- [ ] **Step 2: Send locks from the API helper**

Replace the `optimizeRanked` signature and body in `web/lib/api.ts`:

```ts
export async function optimizeRanked(
  term: string,
  course_codes: string[],
  prefs: Prefs,
  max_solutions = 5,
  instructor_locks: Record<string, string> = {}
) {
  const res = await fetch(`${API_BASE}/optimize/ranked`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      term,
      course_codes,
      max_solutions,
      search_limit: 2000,
      prefs,
      instructor_locks,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`optimizeRanked failed: ${res.status} ${txt}`);
  }
  return res.json();
}
```

- [ ] **Step 3: Accept the new props**

In `web/app/components/CoursePicker.tsx`, change the import line to include the lookup:

```ts
import { loadCourseIndex, searchCourseIndex, getIndexCacheStatus, getCourseFromIndex, CourseIndexEntry } from "@/lib/api";
```

Change the props type to:

```ts
export function CoursePicker(props: Readonly<{
  term: string;
  selected: string[];
  setSelected: (codes: string[]) => void;
  locks: Record<string, string>;
  setLocks: (locks: Record<string, string>) => void;
}>) {
  const { term, selected, setSelected, locks, setLocks } = props;
```

- [ ] **Step 4: Add the setter helper**

Directly below the existing `remove` function inside `CoursePicker`, add:

```ts
  function setLock(courseCode: string, instructor: string) {
    const next = { ...locks };
    if (instructor) {
      next[courseCode] = instructor;
    } else {
      delete next[courseCode];
    }
    setLocks(next);
  }
```

- [ ] **Step 5: Replace the selected-course chips**

The selected courses are currently pills in a wrapping flex row. A dropdown does not fit in a pill, so each becomes a small card. Replace the entire `{/* selected chips */}` block — from `<div style={{ marginTop: 12 }}>` through its closing `</div>` before `{/* search */}` — with:

```tsx
      {/* selected courses, each with an optional professor lock */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Selected</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {selected.length === 0 && <div style={{ color: "var(--text-faint)" }}>No courses selected.</div>}
          {selected.map((code) => {
            const instructors = getCourseFromIndex(term, code)?.instructors ?? [];
            const onlyOne = instructors.length === 1;
            return (
              <div
                key={code}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 10,
                  padding: "8px 10px",
                  background: "var(--surface-2)",
                  fontSize: 13,
                  minWidth: 200,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600 }}>{code}</span>
                  <button
                    onClick={() => remove(code)}
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: 16,
                      lineHeight: "16px",
                      color: "var(--text-muted)",
                    }}
                    aria-label={`Remove ${code}`}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>

                {instructors.length > 0 && (
                  <select
                    value={locks[code] ?? ""}
                    disabled={onlyOne}
                    onChange={(e) => setLock(code, e.target.value)}
                    aria-label={`Professor for ${code}`}
                    title={onlyOne ? "Only one instructor teaches this course" : "Only use sections taught by this professor"}
                    style={{ padding: 4, fontSize: 12, borderRadius: 6, maxWidth: 220 }}
                  >
                    {onlyOne ? (
                      <option value="">{instructors[0]}</option>
                    ) : (
                      <>
                        <option value="">Any professor</option>
                        {instructors.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </>
                    )}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      </div>
```

A course with a single instructor renders that name in a disabled control with an empty value, so it is informational and never sends a lock. A course with no instructor data renders no control at all — which is also what older term indexes produce until they are rebuilt.

- [ ] **Step 6: Add the page state**

In `page.tsx`, below `const [selectedCourses, setSelectedCourses] = useState<string[]>([]);` add:

```tsx
  const [instructorLocks, setInstructorLocks] = useState<Record<string, string>>({});
```

- [ ] **Step 7: Prune locks when a course is removed**

Below the state declarations, add a wrapper that keeps locks consistent with the selection:

```tsx
  // A lock for a course that is no longer selected would be sent to the API
  // and silently constrain nothing, so drop it at the point of removal.
  function handleSetSelectedCourses(codes: string[]) {
    setSelectedCourses(codes);
    setInstructorLocks((prev) => {
      const next: Record<string, string> = {};
      for (const code of codes) {
        if (prev[code]) next[code] = prev[code];
      }
      return next;
    });
  }
```

- [ ] **Step 8: Load locks alongside courses**

In the `loadUserAndSelections` effect, change the `select` to fetch both columns:

```tsx
      const { data: row, error } = await supabase
        .from("user_course_selections")
        .select("courses, instructor_locks")
        .eq("user_id", uid)
        .eq("term", term)
        .maybeSingle();
```

Change the `if (!uid)` early return to also clear locks:

```tsx
      if (!uid) {
        setSelectedCourses([]);
        setInstructorLocks({});
        setSelectionsLoaded(true);
        return;
      }
```

And change the result handling:

```tsx
      if (error) {
        console.warn("Failed to load course selections", error);
        setSelectedCourses([]);
        setInstructorLocks({});
      } else {
        setSelectedCourses(row?.courses ?? []);
        setInstructorLocks(row?.instructor_locks ?? {});
      }
```

- [ ] **Step 9: Save locks alongside courses**

In the debounced save effect, add the column to the upsert payload:

```tsx
          .upsert(
            {
              user_id: userId,
              term,
              courses: selectedCourses,
              instructor_locks: instructorLocks,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,term" }
          );
```

And add `instructorLocks` to that effect's dependency array, which becomes:

```tsx
  }, [supabase, userId, term, selectedCourses, instructorLocks, selectionsLoaded]);
```

- [ ] **Step 10: Send locks when optimising**

In `runOptimize`, the `try` block currently reads:

```tsx
      const data = await optimizeRanked(term, selectedCourses, prefs, 6);
      setResult(data);
      const resultCount = data?.results?.length ?? 0;
```

Replace those three lines with:

```tsx
      const data = await optimizeRanked(term, selectedCourses, prefs, 6, instructorLocks);

      // Must return before setResult: the blocked response has no `results`
      // key, and the results renderer calls result.results.map() unguarded.
      if (data?.ok === false && data?.blocked_by_instructor_lock?.length) {
        setError(data.error);
        return;
      }

      setResult(data);
      const resultCount = data?.results?.length ?? 0;
```

The ordering matters. `setResult(data)` runs before the existing `resultCount` check, and the JSX does `result.results.map(...)` with no guard, so storing a response that lacks `results` would throw during render.

- [ ] **Step 11: Pass the props**

Change the `CoursePicker` usage:

```tsx
          <CoursePicker
            term={term}
            selected={selectedCourses}
            setSelected={handleSetSelectedCourses}
            locks={instructorLocks}
            setLocks={setInstructorLocks}
          />
```

- [ ] **Step 12: Typecheck and build**

```bash
cd web && npx tsc --noEmit && npx next build
```

Expected: both clean.

- [ ] **Step 13: Commit**

```bash
git add web/lib/api.ts web/app/components/CoursePicker.tsx "web/app/(app)/page.tsx"
git commit -m "feat(web): add professor lock picker with persistence"
```

---

### Task 7: End-to-end verification

**Files:** none modified.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Run the whole backend suite**

```bash
cd api && .venv/bin/pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 2: Start the API**

```bash
cd api && MINICATALOG_PATH="../web/public/course-index/{term}.json" \
  .venv/bin/python -m uvicorn main:app --port 8000
```

- [ ] **Step 3: Confirm a lock actually restricts the result**

COMP 1023 has five lecture sections across three lecturers, so it exercises the feature properly. First see who teaches it:

```bash
python3 -c "
import json
d = json.load(open('web/public/course-index/2610.json'))
print(next(c for c in d if c['course_code'] == 'COMP 1023')['instructors'])
"
```

Then optimise with a lock on the first name in that list, substituting it below:

```bash
curl -s -X POST http://127.0.0.1:8000/optimize/ranked \
  -H 'Content-Type: application/json' \
  -d '{"term":"2610","course_codes":["COMP 1023"],"max_solutions":5,
       "instructor_locks":{"COMP 1023":"TSOI, Yau Chat"},"prefs":{}}' \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('ok:', d['ok'])
for r in d['results']:
    for c in r['schedule']:
        for p in c['parts']:
            print(' ', c['course_code'], p['section'], '|', p['instructor'])
"
```

Expected: every returned lecture is taught by the locked professor, or is a TBA lab. No section belongs to another lecturer.

- [ ] **Step 4: Confirm the unsatisfiable path**

```bash
curl -s -X POST http://127.0.0.1:8000/optimize/ranked \
  -H 'Content-Type: application/json' \
  -d '{"term":"2610","course_codes":["COMP 1023"],"max_solutions":5,
       "instructor_locks":{"COMP 1023":"NOBODY, Real"},"prefs":{}}'
```

Expected: `ok: false`, `blocked_by_instructor_lock: ["COMP 1023"]`, and an error naming both the course and `NOBODY, Real`.

- [ ] **Step 5: Confirm nothing regressed without locks**

```bash
curl -s -X POST http://127.0.0.1:8000/optimize/ranked \
  -H 'Content-Type: application/json' \
  -d '{"term":"2610","course_codes":["COMP 2011","FINA 3103"],"max_solutions":1,"prefs":{}}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok:', d['ok'], 'considered:', d['considered'])"
```

Expected: `ok: True` with a non-zero considered count, matching behaviour before this feature.

- [ ] **Step 6: Check the UI in the browser**

Run `cd web && npm run dev`, sign in, and confirm:

1. A multi-lecturer course (COMP 1023) shows a dropdown listing "Any professor" plus each name.
2. A single-lecturer course (FINA 3103) shows one disabled name.
3. Selecting a professor, then reloading the page, restores the selection.
4. Removing a course and re-adding it clears its lock.
5. Optimising with an impossible lock shows the error naming the course and professor.
6. Both light and dark themes render the new control correctly.

- [ ] **Step 7: Push**

```bash
git push origin master
```

Render auto-deploys the backend from master; Vercel auto-deploys the frontend.

---

## Notes for the implementer

- **Render cold starts** take about 50 seconds on the free tier after ~15 minutes idle. If a production check seems to hang, that is why — it is not the solver.
- **`api/` has no package structure.** Imports are flat (`from models import Course`). `api/pytest.ini` sets `pythonpath = .` so tests resolve the same way; run pytest from inside `api/`.
- **Do not touch `scoring.py`.** The lock is a hard constraint enforced by pruning, and there are two known unrelated bugs in that file that are being handled separately.
- **Older term indexes** (2530, 2540) have no `instructors` field. The UI hides the control when the field is absent, which is the intended behaviour — do not add a fallback that fetches instructors some other way.
