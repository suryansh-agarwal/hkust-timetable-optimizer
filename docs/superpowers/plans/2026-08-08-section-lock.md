# Section Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student pin one section per component type (lecture, tutorial, lab) for each course as a hard constraint, with the UI narrowing tutorial and lab options to those the pinned lecture actually permits.

**Architecture:** A pure module (`api/section_lock.py`) owns the pin rule, mirroring `api/instructor_filter.py`. `build_bundles` applies it alongside the existing instructor filter, so the component-emptied guard already in place turns an impossible pin into a clear block rather than a silently wrong schedule. Section data reaches the browser through a new per-course endpoint rather than the static index, and that endpoint returns the component type and matching group computed server-side so the frontend never re-derives section-numbering rules.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 / pytest on the backend. Next.js 16 / React 19 / TypeScript with inline styles on the frontend. Supabase Postgres for persistence.

**Design spec:** `docs/superpowers/specs/2026-08-08-section-lock-design.md`

## Global Constraints

- A section passes the pin rule when no pin exists for its component type, or when it equals that pin. Comparison is case-insensitive after stripping.
- Component keys are exactly `"lecture"`, `"tutorial"`, `"lab"`, mapping from `section_type()` values `LEC`, `TUT`, `LAB`. Sections of type `OTH` are never constrained by a pin.
- `section_locks` is optional everywhere; an absent key means unconstrained, so existing clients keep working unchanged.
- Only `/optimize/ranked` gains the feature. `/optimize/bundles` and `/optimize/basic` are untouched.
- Never re-derive section type or matching group in the frontend. The endpoint returns `type` and `group`; the browser compares them as opaque values.
- Narrowing applies only when a **specific lecture** is pinned, never when a professor is chosen — a professor may teach lectures across several groups.
- Do not add pytest to `api/requirements.txt`; it is `api/requirements-dev.txt`.
- `api/` uses flat imports (`from models import ...`). Match it.
- The frontend uses inline styles with CSS variable tokens from `web/app/globals.css`. Never write a hex literal — use `var(--token)`.
- Do not modify `api/instructor_filter.py`. The professor lock shipped in `6bf408d` and its behaviour must not change.

---

### Task 1: Add the `section_locks` column

**Files:**
- Create: `supabase/migrations/20260808200000_add_section_locks.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `public.user_course_selections.section_locks` — `jsonb NOT NULL DEFAULT '{}'::jsonb`. Task 8 reads and writes it.

The table currently has `user_id`, `term`, `courses`, `updated_at`, `instructor_locks`, primary key `(user_id, term)`, RLS enabled, and roughly 39 rows of real user data. This migration is additive with a default, so existing rows and the current `upsert` keep working untouched.

- [ ] **Step 1: Write the migration**

```sql
-- Per-course section pins, one per component type:
--   {"MATH 1003": {"lecture": "L1", "tutorial": "T1B"}}
-- Sits alongside instructor_locks rather than replacing it, so the professor
-- lock shipped in 6bf408d keeps working with no data migration.
alter table public.user_course_selections
  add column if not exists section_locks jsonb not null default '{}'::jsonb;
```

- [ ] **Step 2: Apply it**

Apply to Supabase project `fjivsrronriyawdtyrvr` with the `apply_migration` MCP tool, name `add_section_locks`, using exactly the SQL above. Load the tool first with:
`ToolSearch` query `select:mcp__claude_ai_Supabase__apply_migration,mcp__claude_ai_Supabase__list_tables,mcp__claude_ai_Supabase__execute_sql`

This is a live production database. Apply exactly this SQL and nothing else.

- [ ] **Step 3: Verify**

Run `execute_sql`:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='user_course_selections'
order by ordinal_position;
```

Expected: `section_locks` present as `jsonb`, `NO` nullable, default `'{}'::jsonb`, and `instructor_locks` still present and unchanged.

- [ ] **Step 4: Verify existing rows survived**

```sql
select count(*) as rows,
       count(*) filter (where section_locks = '{}'::jsonb) as defaulted,
       count(*) filter (where courses is not null) as have_courses
from public.user_course_selections;
```

Expected: `rows == defaulted == have_courses`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260808200000_add_section_locks.sql
git commit -m "feat(db): add section_locks to user_course_selections"
```

---

### Task 2: The pin rule and its tests

**Files:**
- Create: `api/section_lock.py`
- Create: `api/tests/test_section_lock.py`

**Interfaces:**
- Consumes: `section_type` from `api/section_utils.py`.
- Produces:
  - `COMPONENT_KEYS: dict[str, str]` mapping `"LEC" -> "lecture"`, `"TUT" -> "tutorial"`, `"LAB" -> "lab"`
  - `section_allows_pin(section_code: str, section_lock: Optional[dict]) -> bool`

  Task 3 uses `section_allows_pin`.

This mirrors `api/instructor_filter.py`: one small pure module owning one rule, so there is a single place the semantics live.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_section_lock.py`:

```python
from section_lock import COMPONENT_KEYS, section_allows_pin


def test_no_lock_allows_everything():
    for code in ("L1", "T1A", "LA2", "R1"):
        assert section_allows_pin(code, None) is True
        assert section_allows_pin(code, {}) is True


def test_pin_keeps_only_the_named_lecture():
    lock = {"lecture": "L1"}
    assert section_allows_pin("L1", lock) is True
    assert section_allows_pin("L2", lock) is False


def test_pin_on_one_component_does_not_constrain_another():
    # A lecture pin must leave tutorials and labs alone.
    lock = {"lecture": "L1"}
    assert section_allows_pin("T1A", lock) is True
    assert section_allows_pin("LA3", lock) is True


def test_tutorial_and_lab_pins_are_independent():
    lock = {"tutorial": "T1B", "lab": "LA2"}
    assert section_allows_pin("T1B", lock) is True
    assert section_allows_pin("T1A", lock) is False
    assert section_allows_pin("LA2", lock) is True
    assert section_allows_pin("LA1", lock) is False
    # No lecture pin, so every lecture stays eligible.
    assert section_allows_pin("L9", lock) is True


def test_comparison_ignores_case_and_surrounding_space():
    assert section_allows_pin("L1", {"lecture": " l1 "}) is True


def test_unrecognised_section_types_are_never_constrained():
    # "R1" is OTH; no pin key maps to it.
    assert section_allows_pin("R1", {"lecture": "L1", "tutorial": "T1A"}) is True


def test_empty_pin_value_is_treated_as_no_pin():
    assert section_allows_pin("L2", {"lecture": ""}) is True
    assert section_allows_pin("L2", {"lecture": None}) is True


def test_component_keys_cover_the_three_real_types():
    assert COMPONENT_KEYS == {"LEC": "lecture", "TUT": "tutorial", "LAB": "lab"}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd api && .venv/bin/pytest tests/test_section_lock.py -v
```

Expected: collection error, `ModuleNotFoundError: No module named 'section_lock'`.

- [ ] **Step 3: Write the implementation**

Create `api/section_lock.py`:

```python
"""Section pinning for per-component locks.

A student can pin one section per component type. This module owns the single
question "does this section survive the pins?", mirroring instructor_filter's
ownership of the professor rule.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from section_utils import section_type

# Only these three component types can be pinned. A section whose type is OTH
# has no corresponding key and is therefore never constrained.
COMPONENT_KEYS: Dict[str, str] = {"LEC": "lecture", "TUT": "tutorial", "LAB": "lab"}


def section_allows_pin(section_code: str, section_lock: Optional[Dict[str, Any]]) -> bool:
    """
    True when the section survives the pins.

    A pin constrains only its own component type: pinning a lecture must leave
    every tutorial and lab eligible, otherwise pinning one component would
    empty the others and make the course unschedulable.
    """
    if not section_lock:
        return True

    key = COMPONENT_KEYS.get(section_type(section_code))
    if key is None:
        return True

    pinned = section_lock.get(key)
    if not pinned:
        return True

    return section_code.strip().upper() == str(pinned).strip().upper()
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd api && .venv/bin/pytest tests/test_section_lock.py -v
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add api/section_lock.py api/tests/test_section_lock.py
git commit -m "feat(api): add section pin rule with tests"
```

---

### Task 3: Apply pins when building bundles

**Files:**
- Modify: `api/bundles.py` (imports; `build_bundles` signature and section filter)
- Create: `api/tests/test_bundles_section_lock.py`

**Interfaces:**
- Consumes: `section_allows_pin` from Task 2.
- Produces: `build_bundles(course, constraint=None, instructor_lock=None, section_lock=None)`. Task 5 calls it with the fourth argument.

`build_bundles` already computes `had_lec`/`had_tut`/`had_lab` from the unfiltered sections and returns `[]` when a component that existed is emptied by filtering. That guard was added for the professor lock and covers section pins for free: a pin naming a section that does not exist empties its bucket and blocks the course, rather than dropping the component.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_bundles_section_lock.py`:

```python
from bundles import MatchingConstraint, build_bundles
from models import Course, Section


def make_course(sections):
    return Course(
        course_code="MATH 1003",
        title="Calculus and Linear Algebra",
        units=3,
        sections=[
            Section(section=name, class_no=idx + 1, instructor=instructor)
            for idx, (name, instructor) in enumerate(sections)
        ],
    )


def sections_in(bundles):
    return {part.section for bundle in bundles for part in bundle.parts}


LEC_TUT = [
    ("L1", "WU, Yueping"),
    ("L2", "WU, Yueping"),
    ("T1A", "WU, Yueping"),
    ("T1B", "WU, Yueping"),
    ("T2A", "WU, Yueping"),
]


def test_no_pins_is_unchanged():
    course = make_course(LEC_TUT)
    assert sections_in(build_bundles(course)) == {"L1", "L2", "T1A", "T1B", "T2A"}


def test_lecture_pin_keeps_only_that_lecture_and_leaves_tutorials_open():
    course = make_course(LEC_TUT)
    found = sections_in(build_bundles(course, MatchingConstraint(), section_lock={"lecture": "L1"}))
    assert "L1" in found
    assert "L2" not in found
    # No matching rule here, so every tutorial stays available.
    assert {"T1A", "T1B", "T2A"} <= found


def test_tutorial_pin_constrains_only_tutorials():
    course = make_course(LEC_TUT)
    found = sections_in(build_bundles(course, MatchingConstraint(), section_lock={"tutorial": "T1B"}))
    assert found == {"L1", "L2", "T1B"}


def test_pin_naming_a_missing_section_blocks_the_course():
    course = make_course(LEC_TUT)
    assert build_bundles(course, MatchingConstraint(), section_lock={"lecture": "L9"}) == []


def test_matched_course_admits_every_tutorial_in_the_pinned_group():
    course = make_course(LEC_TUT)
    matched = MatchingConstraint(matching_required=True, matching_type="tutorial")
    found = sections_in(build_bundles(course, matched, section_lock={"lecture": "L1"}))
    # L1's group is "1", so T1A and T1B are both valid; T2A is not.
    assert found == {"L1", "T1A", "T1B"}


def test_conflicting_lecture_and_tutorial_pins_block_the_course():
    course = make_course(LEC_TUT)
    matched = MatchingConstraint(matching_required=True, matching_type="tutorial")
    # T2A is in group 2, L1 is in group 1 - impossible together.
    assert build_bundles(course, matched, section_lock={"lecture": "L1", "tutorial": "T2A"}) == []


def test_section_pin_and_instructor_lock_compose():
    course = make_course([
        ("L1", "WU, Yueping"),
        ("L2", "WONG, Ka Yee"),
        ("T1A", "TBA"),
    ])
    found = sections_in(build_bundles(
        course, MatchingConstraint(),
        instructor_lock="WU, Yueping",
        section_lock={"lecture": "L1"},
    ))
    assert found == {"L1", "T1A"}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd api && .venv/bin/pytest tests/test_bundles_section_lock.py -v
```

Expected: failures — `build_bundles()` got an unexpected keyword argument `section_lock`.

- [ ] **Step 3: Add the parameter and the filter**

In `api/bundles.py`, extend the import line:

```python
from instructor_filter import lock_is_satisfiable, section_allows, normalise
from section_lock import section_allows_pin
```

Change the signature from:

```python
def build_bundles(
    course: Course,
    constraint: Optional[MatchingConstraint] = None,
    instructor_lock: Optional[str] = None,
) -> List[Bundle]:
```

to:

```python
def build_bundles(
    course: Course,
    constraint: Optional[MatchingConstraint] = None,
    instructor_lock: Optional[str] = None,
    section_lock: Optional[Dict[str, Any]] = None,
) -> List[Bundle]:
```

Then find this existing line:

```python
    sections = [s for s in course.sections if section_allows(s.instructor, instructor_lock)]
```

and replace it with:

```python
    sections = [
        s
        for s in course.sections
        if section_allows(s.instructor, instructor_lock)
        and section_allows_pin(s.section, section_lock)
    ]
```

The `had_lec`/`had_tut`/`had_lab` guard below already turns an emptied component into `[]`, and the strict-matching logic already narrows tutorials to the pinned lecture's group.

- [ ] **Step 4: Close the fallback for section pins**

There is one more line to change, and skipping it reintroduces a bug that was already fixed once for instructor locks. Near the end of `build_bundles`:

```python
    if not bundles and strict_matching and not normalise(instructor_lock):
```

This fallback exists for inconsistent WCQ data. It was closed for instructor locks in `7259c5c`, but a section pin can break the numeric pairing exactly the same way, and the condition does not know about pins. Verified against the current code: with `L1` and `T2A` surviving under `matching_type: "tutorial"`, it returns `[['L1']]` — a bundle missing the required tutorial.

Change it to:

```python
    if not bundles and strict_matching and not normalise(instructor_lock) and not section_lock:
```

`test_conflicting_lecture_and_tutorial_pins_block_the_course` from Step 1 is the test that fails without this.

- [ ] **Step 5: Run the whole suite**

```bash
cd api && .venv/bin/pytest tests/ -v
```

Expected: all tests pass, including the 28 that existed before this feature.

- [ ] **Step 6: Commit**

```bash
git add api/bundles.py api/tests/test_bundles_section_lock.py
git commit -m "feat(api): apply section pins when building bundles"
```

---

### Task 4: The per-course sections endpoint

**Files:**
- Modify: `api/main.py` (imports; new route)
- Create: `api/tests/test_course_sections_endpoint.py`

**Interfaces:**
- Consumes: `_load_courses_with_cache` and `load_mini_catalog`, both already in `main.py`.
- Produces: `GET /course/sections?term=&course_code=` returning
  `{course_code, matching_required, matching_type, sections: [{section, type, group, instructor, meetings}]}`.
  Task 6 consumes it.

`type` and `group` are computed server-side so the browser never re-implements section numbering. `group` comes from `section_utils.group_key`, the same extraction the matching logic uses.

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_course_sections_endpoint.py`:

```python
import pytest
from fastapi.testclient import TestClient

import main
from models import Course, Meeting, Section


@pytest.fixture
def client(monkeypatch):
    course = Course(
        course_code="MATH 1003",
        title="Calculus and Linear Algebra",
        units=3,
        sections=[
            Section(
                section="L1",
                class_no=1,
                instructor="WU, Yueping",
                meetings=[Meeting(day="Mo", start="09:00AM", end="09:50AM",
                                  day_index=0, start_min=540, end_min=590)],
            ),
            Section(section="T1A", class_no=2, instructor="WU, Yueping"),
            Section(section="LA2", class_no=3, instructor="TBA"),
        ],
    )
    monkeypatch.setattr(
        main, "_load_courses_with_cache", lambda *a, **k: ({"MATH 1003": course}, [], [])
    )
    monkeypatch.setattr(
        main,
        "load_mini_catalog",
        lambda term: {"MATH 1003": {"matching_required": True, "matching_type": "tutorial"}},
    )
    return TestClient(main.app)


def test_returns_type_and_group_for_each_section(client):
    data = client.get("/course/sections", params={"term": "2610", "course_code": "MATH 1003"}).json()
    by_code = {s["section"]: s for s in data["sections"]}
    assert by_code["L1"]["type"] == "LEC"
    assert by_code["T1A"]["type"] == "TUT"
    assert by_code["LA2"]["type"] == "LAB"
    assert by_code["L1"]["group"] == "1"
    assert by_code["T1A"]["group"] == "1"
    assert by_code["LA2"]["group"] == "2"


def test_returns_matching_metadata(client):
    data = client.get("/course/sections", params={"term": "2610", "course_code": "MATH 1003"}).json()
    assert data["course_code"] == "MATH 1003"
    assert data["matching_required"] is True
    assert data["matching_type"] == "tutorial"


def test_includes_instructor_and_meetings(client):
    data = client.get("/course/sections", params={"term": "2610", "course_code": "MATH 1003"}).json()
    lec = next(s for s in data["sections"] if s["section"] == "L1")
    assert lec["instructor"] == "WU, Yueping"
    assert lec["meetings"] == [{"day": "Mo", "start": "09:00AM", "end": "09:50AM"}]


def test_unknown_course_is_404(client):
    res = client.get("/course/sections", params={"term": "2610", "course_code": "NOPE 9999"})
    assert res.status_code == 404
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd api && .venv/bin/pytest tests/test_course_sections_endpoint.py -v
```

Expected: 404 on every request, because the route does not exist yet.

- [ ] **Step 3: Add the import**

`api/main.py` already imports `section_type` from `section_utils`. Extend that line to also bring in `group_key`:

```python
from section_utils import section_type, group_key
```

- [ ] **Step 4: Add the route**

Add to `api/main.py`, directly above the existing `@app.get("/health")` route:

```python
@app.get("/course/sections")
def course_sections(term: str = Query(...), course_code: str = Query(...)):
    """
    Sections for one course, for the section picker.

    `type` and `group` are computed here rather than in the browser: the
    matching rules depend on them, and a second implementation of section
    numbering on the client would eventually disagree with this one.
    """
    normalized = course_code.strip().upper()
    course_map, subjects_fetched, cache_misses = _load_courses_with_cache(
        term, [normalized], refresh=False, use_cache=True
    )
    course = course_map.get(normalized)
    if not course:
        raise HTTPException(status_code=404, detail=f"Course not found: {course_code}")

    try:
        mini_catalog = load_mini_catalog(term)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    entry = mini_catalog.get(normalize_code(normalized)) or {}

    return {
        "course_code": course.course_code,
        "matching_required": bool(entry.get("matching_required", False)),
        "matching_type": entry.get("matching_type"),
        "sections": [
            {
                "section": s.section,
                "type": section_type(s.section),
                "group": group_key(s.section),
                "instructor": s.instructor,
                "meetings": [
                    {"day": m.day, "start": m.start, "end": m.end} for m in s.meetings
                ],
            }
            for s in course.sections
        ],
        "_meta": {"subjects_fetched": subjects_fetched, "cache_misses": cache_misses},
    }
```

- [ ] **Step 5: Run the whole suite**

```bash
cd api && .venv/bin/pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add api/main.py api/tests/test_course_sections_endpoint.py
git commit -m "feat(api): add /course/sections endpoint for the section picker"
```

---

### Task 5: Accept `section_locks` in the optimize endpoint

**Files:**
- Modify: `api/main.py` (`OptimizeRankedRequest`; `optimize_ranked`)
- Modify: `api/tests/test_optimize_instructor_locks.py` (the renamed response key)
- Create: `api/tests/test_optimize_section_locks.py`

**Interfaces:**
- Consumes: `build_bundles(..., section_lock=...)` from Task 3.
- Produces: `POST /optimize/ranked` accepts `section_locks: Dict[str, Dict[str, str]]`, and the blocked response key is renamed from `blocked_by_instructor_lock` to `blocked_by_lock`. Task 8 sends the field.

The rename is a breaking change to a key shipped in `6bf408d`. The only consumer is this repo's frontend, updated in Task 8. The frontend's guard already triggers on `ok === false` generally, so no user-visible behaviour depends on the key name.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_optimize_section_locks.py`:

```python
import pytest
from fastapi.testclient import TestClient

import main
from models import Course, Section


@pytest.fixture
def client(monkeypatch):
    course = Course(
        course_code="MATH 1003",
        title="Calculus and Linear Algebra",
        units=3,
        sections=[
            Section(section="L1", class_no=1, instructor="WU, Yueping"),
            Section(section="L2", class_no=2, instructor="WU, Yueping"),
            Section(section="T1A", class_no=3, instructor="TBA"),
            Section(section="T2A", class_no=4, instructor="TBA"),
        ],
    )
    monkeypatch.setattr(
        main, "_load_courses_with_cache", lambda *a, **k: ({"MATH 1003": course}, [], [])
    )
    monkeypatch.setattr(main, "load_mini_catalog", lambda term: {})
    return TestClient(main.app)


def post(client, **overrides):
    body = {"term": "2610", "course_codes": ["MATH 1003"], "max_solutions": 10, "prefs": {}}
    body.update(overrides)
    return client.post("/optimize/ranked", json=body).json()


def chosen_sections(data):
    return {
        part["section"]
        for result in data["results"]
        for course in result["schedule"]
        for part in course["parts"]
    }


def test_absent_section_locks_still_works(client):
    assert post(client)["ok"] is True


def test_lecture_pin_restricts_results(client):
    data = post(client, section_locks={"MATH 1003": {"lecture": "L1"}})
    assert data["ok"] is True
    found = chosen_sections(data)
    assert "L1" in found
    assert "L2" not in found


def test_pin_naming_a_missing_section_is_reported(client):
    data = post(client, section_locks={"MATH 1003": {"lecture": "L9"}})
    assert data["ok"] is False
    assert data["blocked_by_lock"] == ["MATH 1003"]
    assert "MATH 1003" in data["error"]
    assert "L9" in data["error"]


def test_blocked_message_names_the_professor_when_that_is_the_cause(client):
    data = post(client, instructor_locks={"MATH 1003": "NOBODY, Real"})
    assert data["ok"] is False
    assert data["blocked_by_lock"] == ["MATH 1003"]
    assert "NOBODY, Real" in data["error"]
```

Then update the one stale assertion in `api/tests/test_optimize_instructor_locks.py`, changing:

```python
    assert data["blocked_by_instructor_lock"] == ["COMP 2011"]
```

to:

```python
    assert data["blocked_by_lock"] == ["COMP 2011"]
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd api && .venv/bin/pytest tests/test_optimize_section_locks.py tests/test_optimize_instructor_locks.py -v
```

Expected: the section-lock tests fail (the field is ignored, and `blocked_by_lock` is missing), and the edited instructor test fails on the renamed key.

- [ ] **Step 3: Add the request field**

In `OptimizeRankedRequest`, directly below the existing `instructor_locks` line, add:

```python
    # Course code -> {"lecture": "L1", "tutorial": "T1B", "lab": "LA2"}.
    # Every inner key is optional; an absent one leaves that component free.
    section_locks: Dict[str, Dict[str, str]] = Field(default_factory=dict)
```

- [ ] **Step 4: Describe a lock in the error message**

Add this helper to `api/main.py`, directly above the `optimize_ranked` route:

```python
def _describe_lock(instructor_lock: Optional[str], section_lock: Optional[Dict[str, str]]) -> str:
    """Human-readable summary of why a course was blocked, naming the pins."""
    parts = []
    if instructor_lock:
        parts.append(f"taught by {instructor_lock}")
    for key, label in (("lecture", "lecture"), ("tutorial", "tutorial"), ("lab", "lab")):
        value = (section_lock or {}).get(key)
        if value:
            parts.append(f"{label} {value}")
    return " and ".join(parts) if parts else "the selected constraints"
```

- [ ] **Step 5: Apply the pins and rename the key**

In `optimize_ranked`, replace this existing block:

```python
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

with:

```python
        lock = req.instructor_locks.get(cc)
        pins = req.section_locks.get(cc)
        bundles = build_bundles(course, constraint, instructor_lock=lock, section_lock=pins)
        if not bundles and (lock or pins):
            blocked_by_lock.append(cc)
        choices.append(BundleChoice(course_code=cc, bundles=[b.parts for b in bundles]))

    # Distinct from a generic no-solution: the fix is to drop the lock, not the
    # course, so say which constraint and which course.
    if blocked_by_lock:
        details = ", ".join(
            f"{cc} has no sections matching "
            f"{_describe_lock(req.instructor_locks.get(cc), req.section_locks.get(cc))}"
            for cc in blocked_by_lock
        )
        return {
            "ok": False,
            "error": f"No schedule is possible: {details}.",
            "blocked_by_lock": blocked_by_lock,
            "subjects_fetched": subjects_fetched,
            "cache_misses": cache_misses,
        }
```

`Optional` is already imported in `main.py`.

- [ ] **Step 6: Run the whole suite**

```bash
cd api && .venv/bin/pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add api/main.py api/tests/test_optimize_section_locks.py api/tests/test_optimize_instructor_locks.py
git commit -m "feat(api): accept section_locks in /optimize/ranked"
```

---

### Task 6: Frontend API layer

**Files:**
- Modify: `web/lib/api.ts`

**Interfaces:**
- Consumes: the endpoint from Task 4 and the request field from Task 5.
- Produces:
  - `type CourseSection = { section: string; type: "LEC" | "TUT" | "LAB" | "OTH"; group: string | null; instructor: string | null; meetings: { day: string; start: string; end: string }[] }`
  - `type CourseSections = { course_code: string; matching_required: boolean; matching_type: "lab" | "tutorial" | "both" | null; sections: CourseSection[] }`
  - `type SectionLock = { lecture?: string; tutorial?: string; lab?: string }`
  - `fetchCourseSections(term: string, courseCode: string): Promise<CourseSections>`
  - `optimizeRanked(term, course_codes, prefs, max_solutions, instructor_locks, section_locks)` — sixth parameter, defaults to `{}`

  Task 7 uses the types and the fetch; Task 8 passes `section_locks`.

- [ ] **Step 1: Add the types and the cached fetch**

Add to `web/lib/api.ts`, directly below the `getCourseFromIndex` function:

```ts
// ============================================================
// Per-course section data (for the section picker)
// ============================================================

export type CourseSection = {
  section: string;
  type: "LEC" | "TUT" | "LAB" | "OTH";
  // Matching group, computed server-side. Compare as an opaque value; never
  // re-derive it here, or it will drift from the optimiser's rule.
  group: string | null;
  instructor: string | null;
  meetings: { day: string; start: string; end: string }[];
};

export type CourseSections = {
  course_code: string;
  matching_required: boolean;
  matching_type: "lab" | "tutorial" | "both" | null;
  sections: CourseSection[];
};

export type SectionLock = { lecture?: string; tutorial?: string; lab?: string };

const sectionsCache: Map<string, CourseSections> = new Map();

/**
 * Sections for one course. Cached per term+course for the session; section
 * times change rarely enough within a sitting, and this keeps the picker
 * from refetching every time a dropdown opens.
 */
export async function fetchCourseSections(
  term: string,
  courseCode: string
): Promise<CourseSections> {
  const key = `${term}:${courseCode}`;
  const cached = sectionsCache.get(key);
  if (cached) return cached;

  const url = `${API_BASE}/course/sections?term=${encodeURIComponent(term)}&course_code=${encodeURIComponent(courseCode)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchCourseSections failed: ${res.status}`);

  const data: CourseSections = await res.json();
  sectionsCache.set(key, data);
  return data;
}
```

- [ ] **Step 2: Send section locks**

Replace the `optimizeRanked` signature and body in `web/lib/api.ts`:

```ts
export async function optimizeRanked(
  term: string,
  course_codes: string[],
  prefs: Prefs,
  max_solutions = 5,
  instructor_locks: Record<string, string> = {},
  section_locks: Record<string, SectionLock> = {}
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
      section_locks,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`optimizeRanked failed: ${res.status} ${txt}`);
  }
  return res.json();
}
```

- [ ] **Step 3: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: clean. Both changes are additive with defaults, so no caller breaks.

- [ ] **Step 4: Commit**

```bash
git add web/lib/api.ts
git commit -m "feat(web): add section fetch and section_locks to the API layer"
```

---

### Task 7: Narrowing helper and its tests

**Files:**
- Create: `web/lib/sectionOptions.ts`
- Create: `web/lib/sectionOptions.test.ts`
- Modify: `web/package.json` (test script)
- Create: `web/vitest.config.ts`

**Interfaces:**
- Consumes: `CourseSections`, `CourseSection`, `SectionLock` from Task 6.
- Produces:
  - `optionsFor(data: CourseSections, kind: "LEC" | "TUT" | "LAB", lecturePin?: string): CourseSection[]`
  - `reconcilePins(data: CourseSections, pins: SectionLock): SectionLock`

  Task 8 uses both.

The narrowing rule is the highest-risk logic in this feature and it is pure — it takes data and pins and returns options. Extracting it into a plain module means it can be tested without a browser. Vitest is added for this module only; no component tests.

- [ ] **Step 1: Add Vitest**

```bash
cd web && npm install -D vitest
```

Create `web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
```

Add to the `scripts` block in `web/package.json`:

```json
    "test": "vitest run",
```

- [ ] **Step 2: Write the failing tests**

Create `web/lib/sectionOptions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { optionsFor, reconcilePins } from "./sectionOptions";
import type { CourseSections } from "./api";

function sec(section: string, type: "LEC" | "TUT" | "LAB", group: string | null) {
  return { section, type, group, instructor: null, meetings: [] };
}

// MATH 1003 shape: matching on tutorials, four tutorials per lecture group.
const MATCHED: CourseSections = {
  course_code: "MATH 1003",
  matching_required: true,
  matching_type: "tutorial",
  sections: [
    sec("L1", "LEC", "1"), sec("L2", "LEC", "2"),
    sec("T1A", "TUT", "1"), sec("T1B", "TUT", "1"),
    sec("T2A", "TUT", "2"), sec("T2B", "TUT", "2"),
  ],
};

const UNMATCHED: CourseSections = {
  course_code: "ECON 2103",
  matching_required: false,
  matching_type: null,
  sections: [
    sec("L1", "LEC", "1"), sec("L2", "LEC", "2"),
    sec("T1", "TUT", "1"), sec("T2", "TUT", "2"),
  ],
};

describe("optionsFor", () => {
  it("returns every section of the kind when no lecture is pinned", () => {
    expect(optionsFor(MATCHED, "TUT").map((s) => s.section))
      .toEqual(["T1A", "T1B", "T2A", "T2B"]);
  });

  it("narrows tutorials to the pinned lecture's group on a matched course", () => {
    expect(optionsFor(MATCHED, "TUT", "L1").map((s) => s.section))
      .toEqual(["T1A", "T1B"]);
  });

  it("does not narrow when the course has no matching rule", () => {
    expect(optionsFor(UNMATCHED, "TUT", "L1").map((s) => s.section))
      .toEqual(["T1", "T2"]);
  });

  it("does not narrow labs when matching_type is tutorial only", () => {
    const withLabs: CourseSections = {
      ...MATCHED,
      sections: [...MATCHED.sections, sec("LA1", "LAB", "1"), sec("LA2", "LAB", "2")],
    };
    expect(optionsFor(withLabs, "LAB", "L1").map((s) => s.section))
      .toEqual(["LA1", "LA2"]);
  });

  it("narrows labs too when matching_type is both", () => {
    const both: CourseSections = {
      ...MATCHED,
      matching_type: "both",
      sections: [...MATCHED.sections, sec("LA1", "LAB", "1"), sec("LA2", "LAB", "2")],
    };
    expect(optionsFor(both, "LAB", "L1").map((s) => s.section)).toEqual(["LA1"]);
  });

  it("falls back to every option when the pinned lecture is unknown", () => {
    expect(optionsFor(MATCHED, "TUT", "L9").map((s) => s.section))
      .toEqual(["T1A", "T1B", "T2A", "T2B"]);
  });
});

describe("reconcilePins", () => {
  it("keeps a tutorial pin that is still valid", () => {
    expect(reconcilePins(MATCHED, { lecture: "L1", tutorial: "T1B" }))
      .toEqual({ lecture: "L1", tutorial: "T1B" });
  });

  it("clears a tutorial pin invalidated by changing the lecture", () => {
    // Was L1+T1B; the student switched to L2, so T1B is impossible.
    expect(reconcilePins(MATCHED, { lecture: "L2", tutorial: "T1B" }))
      .toEqual({ lecture: "L2" });
  });

  it("auto-selects when narrowing leaves exactly one option", () => {
    const single: CourseSections = {
      ...MATCHED,
      sections: [sec("L1", "LEC", "1"), sec("L2", "LEC", "2"), sec("T1", "TUT", "1"), sec("T2", "TUT", "2")],
    };
    expect(reconcilePins(single, { lecture: "L1" })).toEqual({ lecture: "L1", tutorial: "T1" });
  });

  it("does not auto-select when several options remain", () => {
    expect(reconcilePins(MATCHED, { lecture: "L1" })).toEqual({ lecture: "L1" });
  });

  it("leaves pins alone on an unmatched course", () => {
    expect(reconcilePins(UNMATCHED, { lecture: "L1", tutorial: "T2" }))
      .toEqual({ lecture: "L1", tutorial: "T2" });
  });

  it("drops a pin naming a section that does not exist", () => {
    expect(reconcilePins(MATCHED, { lecture: "L1", tutorial: "T9Z" }))
      .toEqual({ lecture: "L1" });
  });

  it("is idempotent", () => {
    const once = reconcilePins(MATCHED, { lecture: "L2", tutorial: "T1B" });
    expect(reconcilePins(MATCHED, once)).toEqual(once);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd web && npx vitest run
```

Expected: cannot resolve `./sectionOptions`.

- [ ] **Step 4: Write the implementation**

Create `web/lib/sectionOptions.ts`:

```ts
import type { CourseSection, CourseSections, SectionLock } from "./api";

const KIND_TO_KEY = { LEC: "lecture", TUT: "tutorial", LAB: "lab" } as const;

type PinnableKind = keyof typeof KIND_TO_KEY;

/**
 * Does the course's matching rule tie this component to the lecture?
 */
function matchingApplies(data: CourseSections, kind: PinnableKind): boolean {
  if (!data.matching_required || kind === "LEC") return false;
  const wanted = kind === "TUT" ? "tutorial" : "lab";
  return data.matching_type === wanted || data.matching_type === "both";
}

/**
 * The sections a student may choose for one component type.
 *
 * Matching constrains the numeric group, not the individual section: on
 * MATH 1003 the pinned lecture L1 permits T1A, T1B, T1C and T1D. So a pinned
 * lecture narrows the list rather than determining it.
 */
export function optionsFor(
  data: CourseSections,
  kind: PinnableKind,
  lecturePin?: string
): CourseSection[] {
  const all = data.sections.filter((s) => s.type === kind);
  if (!matchingApplies(data, kind) || !lecturePin) return all;

  const lecture = data.sections.find((s) => s.section === lecturePin);
  // An unknown or ungrouped lecture cannot narrow anything; showing every
  // option is safer than showing none, and the backend still rejects an
  // invalid combination.
  if (!lecture?.group) return all;

  return all.filter((s) => s.group === lecture.group);
}

/**
 * Bring a course's pins back into agreement with what is actually selectable.
 *
 * Drops a pin that names a section which no longer exists or is no longer
 * permitted by the pinned lecture, and fills in a pin when narrowing leaves
 * exactly one candidate. Idempotent, so it is safe to run on every render.
 */
export function reconcilePins(data: CourseSections, pins: SectionLock): SectionLock {
  const next: SectionLock = {};

  const lectures = optionsFor(data, "LEC");
  if (pins.lecture && lectures.some((s) => s.section === pins.lecture)) {
    next.lecture = pins.lecture;
  }

  for (const kind of ["TUT", "LAB"] as const) {
    const key = KIND_TO_KEY[kind];
    const options = optionsFor(data, kind, next.lecture);
    if (options.length === 0) continue;

    const current = pins[key];
    if (current && options.some((s) => s.section === current)) {
      next[key] = current;
    } else if (matchingApplies(data, kind) && next.lecture && options.length === 1) {
      // Exactly one valid choice: pin it so the request matches what the
      // disabled control shows.
      next[key] = options[0].section;
    }
  }

  return next;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd web && npx vitest run
```

Expected: 13 passed.

- [ ] **Step 6: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add web/lib/sectionOptions.ts web/lib/sectionOptions.test.ts web/vitest.config.ts web/package.json web/package-lock.json
git commit -m "feat(web): add section narrowing logic with tests"
```

---

### Task 8: The picker UI, state and persistence

**Files:**
- Modify: `web/app/components/CoursePicker.tsx`
- Modify: `web/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `fetchCourseSections`, `SectionLock` from Task 6; `optionsFor`, `reconcilePins` from Task 7; the `section_locks` column from Task 1.
- Produces: nothing downstream.

One task because adding required props to `CoursePicker` breaks the typecheck until `page.tsx` supplies them; split, the intermediate state would not build.

- [ ] **Step 1: Extend the page state**

In `web/app/(app)/page.tsx`, below the existing `instructorLocks` state, add:

```tsx
  const [sectionLocks, setSectionLocks] = useState<Record<string, SectionLock>>({});
```

Extend the import from `@/lib/api` to include `SectionLock`.

- [ ] **Step 2: Prune section locks on removal**

Extend the existing `handleSetSelectedCourses` so it prunes both maps:

```tsx
  function handleSetSelectedCourses(codes: string[]) {
    setSelectedCourses(codes);
    setInstructorLocks((prev) => {
      const next: Record<string, string> = {};
      for (const code of codes) {
        if (prev[code]) next[code] = prev[code];
      }
      return next;
    });
    setSectionLocks((prev) => {
      const next: Record<string, SectionLock> = {};
      for (const code of codes) {
        if (prev[code]) next[code] = prev[code];
      }
      return next;
    });
  }
```

- [ ] **Step 3: Load and save section locks**

In the load effect, change the select to fetch all three columns:

```tsx
        .select("courses, instructor_locks, section_locks")
```

Set `setSectionLocks({})` everywhere `setInstructorLocks({})` already appears (the no-user branch and the error branch), and in the success branch add:

```tsx
        setSectionLocks(row?.section_locks ?? {});
```

In the debounced save effect, add the column to the upsert payload:

```tsx
              section_locks: sectionLocks,
```

and add `sectionLocks` to that effect's dependency array.

- [ ] **Step 4: Send section locks when optimising**

Change the call:

```tsx
      const data = await optimizeRanked(term, selectedCourses, prefs, 6, instructorLocks, sectionLocks);
```

The existing blocked-lock early return stays exactly where it is, immediately before `setResult(data)`.

- [ ] **Step 5: Pass the new props**

```tsx
          <CoursePicker
            term={term}
            selected={selectedCourses}
            setSelected={handleSetSelectedCourses}
            locks={instructorLocks}
            setLocks={setInstructorLocks}
            sectionLocks={sectionLocks}
            setSectionLocks={setSectionLocks}
          />
```

- [ ] **Step 6: Accept the props in CoursePicker**

In `web/app/components/CoursePicker.tsx`, extend the props type and destructuring:

```tsx
export function CoursePicker(props: Readonly<{
  term: string;
  selected: string[];
  setSelected: (codes: string[]) => void;
  locks: Record<string, string>;
  setLocks: (locks: Record<string, string>) => void;
  sectionLocks: Record<string, SectionLock>;
  setSectionLocks: (locks: Record<string, SectionLock>) => void;
}>) {
  const { term, selected, setSelected, locks, setLocks, sectionLocks, setSectionLocks } = props;
```

Extend the `react` import to include the `ReactNode` type (the file imports named hooks only, so `React.ReactNode` is not in scope):

```tsx
import { useEffect, useState, useMemo, type ReactNode } from "react";
```

Extend the `@/lib/api` import to include `fetchCourseSections`, and add:

```tsx
import type { CourseSections, SectionLock } from "@/lib/api";
import { optionsFor, reconcilePins } from "@/lib/sectionOptions";
```

- [ ] **Step 7: Fetch sections for selected courses**

Add this state and effect inside `CoursePicker`, below the existing index effect:

```tsx
  const [sectionData, setSectionData] = useState<Record<string, CourseSections>>({});

  // Section data is per course and fetched on demand, so a student who picks
  // five courses pays for five small requests rather than a doubled index.
  useEffect(() => {
    let cancelled = false;
    const missing = selected.filter((code) => !sectionData[code]);
    if (missing.length === 0) return;

    (async () => {
      for (const code of missing) {
        try {
          const data = await fetchCourseSections(term, code);
          if (cancelled) return;
          setSectionData((prev) => ({ ...prev, [code]: data }));
        } catch {
          // A course whose sections cannot be loaded simply offers no pins.
          // The optimiser still works; only the picker is degraded.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [term, selected, sectionData]);

  // Section data is per term; drop it when the term changes.
  useEffect(() => {
    setSectionData({});
  }, [term]);
```

- [ ] **Step 8: Keep pins consistent**

Add below the fetch effect:

```tsx
  // reconcilePins is idempotent, so this settles in one pass: it only writes
  // when a pin was dropped or auto-filled.
  useEffect(() => {
    let changed = false;
    const next: Record<string, SectionLock> = {};

    for (const code of selected) {
      const data = sectionData[code];
      const current = sectionLocks[code] ?? {};
      if (!data) {
        if (Object.keys(current).length > 0) next[code] = current;
        continue;
      }
      const reconciled = reconcilePins(data, current);
      if (Object.keys(reconciled).length > 0) next[code] = reconciled;
      // Field-by-field, not JSON.stringify: pins loaded from Postgres can
      // arrive with their keys in any order, and a string comparison would
      // see that as a change on every render.
      if (!samePins(reconciled, current)) changed = true;
    }

    if (changed || Object.keys(next).length !== Object.keys(sectionLocks).length) {
      setSectionLocks(next);
    }
  }, [selected, sectionData, sectionLocks, setSectionLocks]);
```

- [ ] **Step 9: Add the setter helper**

Below the existing `setLock` function:

```tsx
  function setPin(courseCode: string, kind: "lecture" | "tutorial" | "lab", value: string) {
    const current = sectionLocks[courseCode] ?? {};
    const updated: SectionLock = { ...current };
    if (value) {
      updated[kind] = value;
    } else {
      delete updated[kind];
    }
    setSectionLocks({ ...sectionLocks, [courseCode]: updated });
  }
```

- [ ] **Step 10: Render the component controls**

Inside the selected-course card, replace the existing professor `<select>` block with the following. The lecture control absorbs the professor options, per the design.

```tsx
                {(() => {
                  const data = sectionData[code];
                  const pins = sectionLocks[code] ?? {};
                  if (!data) {
                    return instructors.length > 0 ? (
                      <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Loading sections…</div>
                    ) : null;
                  }

                  const lectures = optionsFor(data, "LEC");
                  const rows: ReactNode[] = [];

                  if (lectures.length > 0 || instructors.length > 0) {
                    rows.push(
                      <label key="lec" style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "var(--text-muted)" }}>
                        Lecture
                        <select
                          value={pins.lecture ?? (locks[code] ? `prof:${locks[code]}` : "")}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v.startsWith("prof:")) {
                              setLock(code, v.slice(5));
                              setPin(code, "lecture", "");
                            } else {
                              setLock(code, "");
                              setPin(code, "lecture", v);
                            }
                          }}
                          style={{ padding: 4, fontSize: 12, borderRadius: 6, maxWidth: 240 }}
                        >
                          <option value="">Any</option>
                          {instructors.length > 0 && (
                            <optgroup label="Professor">
                              {instructors.map((n) => (
                                <option key={n} value={`prof:${n}`}>{n}</option>
                              ))}
                            </optgroup>
                          )}
                          {lectures.length > 0 && (
                            <optgroup label="Lecture">
                              {lectures.map((s) => (
                                <option key={s.section} value={s.section}>
                                  {s.section} · {summarise(s)}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </label>
                    );
                  }

                  for (const kind of ["TUT", "LAB"] as const) {
                    const key = kind === "TUT" ? "tutorial" : "lab";
                    const options = optionsFor(data, kind, pins.lecture);
                    if (options.length === 0) continue;
                    const auto = data.matching_required && !!pins.lecture && options.length === 1;
                    rows.push(
                      <label key={kind} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "var(--text-muted)" }}>
                        {kind === "TUT" ? "Tutorial" : "Lab"}
                        <select
                          value={pins[key] ?? ""}
                          disabled={auto}
                          onChange={(e) => setPin(code, key, e.target.value)}
                          title={auto ? "Determined by the lecture you picked" : undefined}
                          style={{ padding: 4, fontSize: 12, borderRadius: 6, maxWidth: 240 }}
                        >
                          {!auto && <option value="">Any</option>}
                          {options.map((s) => (
                            <option key={s.section} value={s.section}>
                              {s.section} · {summarise(s)}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  }

                  return <>{rows}</>;
                })()}
```

Add these helpers at module level in `CoursePicker.tsx`, above the component:

```tsx
function samePins(a: SectionLock, b: SectionLock) {
  return a.lecture === b.lecture && a.tutorial === b.tutorial && a.lab === b.lab;
}

function summarise(s: { meetings: { day: string; start: string; end: string }[] }) {
  if (s.meetings.length === 0) return "no meetings";
  const days = s.meetings.map((m) => m.day).join("/");
  return `${days} ${s.meetings[0].start}`;
}
```

- [ ] **Step 11: Verify**

```bash
cd web && npx tsc --noEmit && npx vitest run && npx next build
```

Expected: all three clean.

- [ ] **Step 12: Commit**

```bash
git add web/app/components/CoursePicker.tsx "web/app/(app)/page.tsx"
git commit -m "feat(web): add per-component section pickers with narrowing"
```

---

### Task 9: End-to-end verification

**Files:** none modified.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Run both suites**

```bash
cd api && .venv/bin/pytest tests/ -q
cd ../web && npx vitest run && npx tsc --noEmit && npx next build
```

Expected: all green.

- [ ] **Step 2: Start the API**

```bash
cd api && MINICATALOG_PATH="../web/public/course-index/{term}.json" \
  .venv/bin/python -m uvicorn main:app --port 8000
```

- [ ] **Step 3: Check the endpoint against a matched course**

```bash
curl -s "http://127.0.0.1:8000/course/sections?term=2610&course_code=MATH%201003" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('matching:', d['matching_required'], d['matching_type'])
for s in d['sections'][:10]:
    print(' ', s['section'], s['type'], 'group=', s['group'], '|', s['instructor'])
"
```

Expected: `matching_required` true with `matching_type` tutorial, lectures reporting `type: LEC` with a group, and tutorials `T1A`/`T1B` reporting group `1`.

- [ ] **Step 4: Confirm a lecture pin restricts results**

```bash
curl -s -X POST http://127.0.0.1:8000/optimize/ranked \
  -H 'Content-Type: application/json' \
  -d '{"term":"2610","course_codes":["MATH 1003"],"max_solutions":10,
       "section_locks":{"MATH 1003":{"lecture":"L1"}},"prefs":{}}' \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('ok:', d['ok'])
secs={p['section'] for r in d['results'] for c in r['schedule'] for p in c['parts']}
print('sections returned:', sorted(secs))
assert not any(s.startswith('L') and not s.startswith('LA') and s!='L1' for s in secs), 'another lecture leaked'
print('OK: only L1 among lectures')
"
```

- [ ] **Step 5: Confirm an impossible pin is reported**

```bash
curl -s -X POST http://127.0.0.1:8000/optimize/ranked \
  -H 'Content-Type: application/json' \
  -d '{"term":"2610","course_codes":["MATH 1003"],"max_solutions":5,
       "section_locks":{"MATH 1003":{"lecture":"L99"}},"prefs":{}}'
```

Expected: `ok: false`, `blocked_by_lock: ["MATH 1003"]`, and an error naming both `MATH 1003` and `L99`.

- [ ] **Step 6: Confirm no regression without locks**

```bash
curl -s -X POST http://127.0.0.1:8000/optimize/ranked \
  -H 'Content-Type: application/json' \
  -d '{"term":"2610","course_codes":["COMP 2011","FINA 3103"],"max_solutions":1,"prefs":{}}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok:', d['ok'], 'considered:', d['considered'])"
```

Expected: `ok: True` with a non-zero considered count.

Kill the uvicorn process when done.

- [ ] **Step 7: The four manual browser checks**

These cover the narrowing logic end to end. Run `cd web && npm run dev`, sign in, select **MATH 1003**, and confirm:

1. **Multi-candidate narrowing** — pin lecture `L1`. The Tutorial control stays enabled and offers exactly `T1A`–`T1D`, with no `T2x`.
2. **Re-narrowing** — switch the lecture to `L2`. The Tutorial options become `T2A`–`T2D`.
3. **Invalidation** — pin `L1` then `T1B`, then switch the lecture to `L2`. The tutorial pin clears rather than remaining as an impossible `L2`+`T1B`.
4. **Single-candidate auto-select** — on a matched course whose lecture group holds one tutorial, pinning the lecture selects that tutorial and disables the control.

Then confirm persistence: set pins, reload the page, and check they return. Finally check both light and dark themes.

- [ ] **Step 8: Report**

Do not push. Report results and let the repo owner decide on integration.

---

## Notes for the implementer

- **Do not modify `api/instructor_filter.py`.** The professor lock shipped and its behaviour is fixed.
- **`build_bundles` already has the component-emptied guard.** It returns `[]` when a component that existed before filtering is empty after. Section pins rely on it; do not add a second guard.
- **Matching narrows by group, not by section.** MATH 1003 L1 permits T1A–T1D. Any code or test that assumes a lecture determines exactly one tutorial is wrong.
- **`api/` has no package structure.** Run pytest from inside `api/`; `pytest.ini` sets `pythonpath = .`.
- **Render cold starts** take about 50 seconds on the free tier; a slow first production request is not a bug.
