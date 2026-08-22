# Why No Timetable Was Possible — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the optimiser returns nothing, name the input that made it impossible instead of guessing at "subjects/sections".

**Architecture:** One new pure module holds both diagnoses so they can be tested without FastAPI. `main.py` calls them at the two points that already know the answer is "nothing" — after the pool is built, and after the pool is filtered — and returns the `ok: false` shape `blocked_by_lock` already uses, which the frontend already routes to a persistent panel.

**Tech Stack:** FastAPI + Pydantic v2, flat imports (`from models import Course`), pytest with `pythonpath = .`.

**Design spec:** `docs/superpowers/specs/2026-08-22-infeasibility-diagnosis-design.md`

**Branch:** all tasks land on `feature/infeasibility-diagnosis`, cut from `master`. Create it before Task 1:

```bash
git checkout -b feature/infeasibility-diagnosis
```

## Global Constraints

- **Diagnosis runs only on a failing path.** Neither function may be called when the optimiser is about to succeed. A successful response must be byte-identical to today's.
- **`blocked_by_lock` keeps precedence.** It fires earlier, for the single-course case, and its message is better than anything here because it names one course. Do not move, weaken or duplicate it.
- **Never name a constraint that is not the blocker.** A pair of courses that *partially* conflict must not be reported; a hard rule that rejected only some schedules must not be named. Sending a student to change the wrong input is worse than saying "these cannot all coexist".
- **No new dependencies.** `itertools` is stdlib; `bundle_conflicts` already exists.
- Python only, plus one comment in `web/app/(app)/page.tsx`. No other frontend change, and **no change to the toast's wording** — it is the project owner's.
- The web suite stays at 59 and `next build` stays clean.
- **`/optimize/ranked` only.** `main.py` builds `BundleChoice` and calls `find_bundle_schedules` in two places — `:260`/`:279` for `/optimize/ranked`, and `:424`/`:426` for `/optimize/bundles`. Only the first is reachable from the app: `web/lib/api.ts:229` is the sole caller and it hits `/optimize/ranked`. `/optimize/bundles` and `/optimize/basic` are unused legacy endpoints and are deliberately left alone. Do not diagnose there; a reviewer noticing the second call site should read this line rather than treat it as a gap.

## A fact that shapes Task 1, verified against `scoring.py`

`score_schedule` has **three** `return REJECTED_SCORE, breakdown` statements — `scoring.py:118`, `:131`, `:144` — one per hard-constraint family, each returning the moment it finds a violation.

**So a rejected schedule's breakdown carries exactly one hard violation: the first one hit.** Not every rule that schedule breaks.

That rules out the obvious implementation. Intersecting violations across rejected schedules would find only rules every schedule hit *first*, and would report nothing in the common case where schedule A trips a free-day rule and schedule B trips a cutoff — even though between them those two reject everything.

The honest answer is the **union** of what was observed, worded to match: every schedule breaks *at least one of* these rules. With a single member the wording collapses to the precise "every schedule breaks: …".

Making `score_schedule` collect all violations would give a sharper answer. Out of scope — it changes behaviour the existing suite pins down.

## File Structure

| File | Responsibility |
|---|---|
| `api/infeasibility.py` (new) | Both diagnoses, as pure functions over data the caller already has. No FastAPI, no I/O. |
| `api/tests/test_infeasibility.py` (new) | Unit tests, including the negative cases that matter more than the positive ones. |
| `api/main.py` | Calls each diagnosis at the point that already failed, and builds the response. |
| `web/app/(app)/page.tsx` | One comment recording that the toast is now a fallback. |

---

### Task 1: The two diagnoses, as pure functions

**Files:**
- Create: `api/infeasibility.py`
- Test: `api/tests/test_infeasibility.py`

**Interfaces:**
- Consumes: `BundleChoice` and `bundle_conflicts` from `optimizer_bundles`.
- Produces: `mutually_exclusive_pairs(choices) -> List[Tuple[str, str]]` and `blocking_hard_rules(breakdowns) -> List[Dict[str, Optional[str]]]`. Tasks 2 and 3 call these.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_infeasibility.py`. The negative cases are the point — a diagnosis that names an innocent constraint is worse than no diagnosis.

```python
"""Why the optimiser returned nothing.

Zero results has three causes needing different remedies: locks that clash
across courses, hard preferences that reject every schedule, and courses that
simply cannot coexist. The tests that matter most here are the negative ones -
naming a constraint that was not the blocker sends a student to change
something that was never the problem.
"""

from infeasibility import blocking_hard_rules, mutually_exclusive_pairs
from models import Meeting, Section
from optimizer_bundles import BundleChoice


def meeting(day_index, start_min, end_min):
    return Meeting(
        day=["Mo", "Tu", "We", "Th", "Fr"][day_index],
        start="09:00AM",
        end="10:20AM",
        day_index=day_index,
        start_min=start_min,
        end_min=end_min,
    )


def section(name, day_index, start_min, end_min):
    return Section(
        section=name,
        class_no=abs(hash(name)) % 9000,
        meetings=[meeting(day_index, start_min, end_min)],
    )


def choice(code, *bundles):
    return BundleChoice(course_code=code, bundles=list(bundles))


class TestMutuallyExclusivePairs:
    def test_names_a_pair_whose_every_option_clashes(self):
        # Each course has one surviving option, both Monday 09:00-10:20.
        a = choice("COMP 2011", [section("L2", 0, 540, 620)])
        b = choice("MATH 1014", [section("L1", 0, 540, 620)])
        assert mutually_exclusive_pairs([a, b]) == [("COMP 2011", "MATH 1014")]

    def test_stays_silent_when_one_combination_survives(self):
        # The case that matters: A's L1 clashes with B's L1, but A's L2 does
        # not. Reporting this pair would send the student to change a course
        # that is not the problem.
        a = choice("COMP 2011", [section("L1", 0, 540, 620)], [section("L2", 1, 540, 620)])
        b = choice("MATH 1014", [section("L1", 0, 540, 620)])
        assert mutually_exclusive_pairs([a, b]) == []

    def test_stays_silent_when_nothing_clashes(self):
        a = choice("COMP 2011", [section("L1", 0, 540, 620)])
        b = choice("MATH 1014", [section("L1", 1, 540, 620)])
        assert mutually_exclusive_pairs([a, b]) == []

    def test_ignores_a_course_with_no_options_at_all(self):
        # An empty course is blocked_by_lock's business - it fires earlier and
        # names one course, which is a better message than naming a pair.
        a = choice("COMP 2011")
        b = choice("MATH 1014", [section("L1", 0, 540, 620)])
        assert mutually_exclusive_pairs([a, b]) == []

    def test_finds_every_exclusive_pair_not_just_the_first(self):
        a = choice("A 1000", [section("L1", 0, 540, 620)])
        b = choice("B 1000", [section("L1", 0, 540, 620)])
        c = choice("C 1000", [section("L1", 0, 540, 620)])
        assert mutually_exclusive_pairs([a, b, c]) == [
            ("A 1000", "B 1000"),
            ("A 1000", "C 1000"),
            ("B 1000", "C 1000"),
        ]

    def test_a_multi_part_bundle_clashes_if_any_part_does(self):
        # A bundle is a lecture plus its tutorial; one clashing part is enough.
        a = choice("COMP 2011", [section("L1", 0, 540, 620), section("T1", 2, 600, 680)])
        b = choice("MATH 1014", [section("L1", 2, 640, 700)])
        assert mutually_exclusive_pairs([a, b]) == [("COMP 2011", "MATH 1014")]


class TestBlockingHardRules:
    def rejected(self, **kw):
        return {"rejected": True, "penalties": [dict(**kw)], "bonuses": []}

    def test_names_the_rule_every_schedule_broke(self):
        bds = [
            self.rejected(type="hard_no_after_violation", day="Fr", cutoff="15:00"),
            self.rejected(type="hard_no_after_violation", day="Fr", cutoff="15:00"),
        ]
        assert blocking_hard_rules(bds) == [
            {"type": "hard_no_after_violation", "day": "Fr", "cutoff": "15:00"}
        ]

    def test_unions_rather_than_intersects(self):
        # score_schedule returns on the FIRST hard violation, so one schedule
        # tripping a free day and another tripping a cutoff means each
        # breakdown holds a different single rule. Intersecting would report
        # nothing while both rules are jointly responsible.
        bds = [
            self.rejected(type="hard_free_day_violation", day="Tu"),
            self.rejected(type="hard_no_after_violation", day="Fr", cutoff="15:00"),
        ]
        assert blocking_hard_rules(bds) == [
            {"type": "hard_free_day_violation", "day": "Tu", "cutoff": None},
            {"type": "hard_no_after_violation", "day": "Fr", "cutoff": "15:00"},
        ]

    def test_deduplicates_the_same_rule_seen_many_times(self):
        bds = [self.rejected(type="hard_free_day_violation", day="Tu")] * 5
        assert blocking_hard_rules(bds) == [
            {"type": "hard_free_day_violation", "day": "Tu", "cutoff": None}
        ]

    def test_ignores_soft_penalties(self):
        bds = [{
            "rejected": True,
            "penalties": [
                {"type": "gaps_minutes", "minutes": 120},
                {"type": "soft_free_day", "day": "We"},
                {"type": "hard_free_day_violation", "day": "Tu"},
            ],
            "bonuses": [],
        }]
        assert blocking_hard_rules(bds) == [
            {"type": "hard_free_day_violation", "day": "Tu", "cutoff": None}
        ]

    def test_returns_nothing_for_an_empty_pool(self):
        assert blocking_hard_rules([]) == []
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd api && .venv/bin/pytest tests/test_infeasibility.py -q
```

Expected: a collection error, `ModuleNotFoundError: No module named 'infeasibility'`. That is the correct red for a module that does not exist yet.

- [ ] **Step 3: Write the module**

Create `api/infeasibility.py`:

```python
"""Why the optimiser returned nothing.

`blocked_by_lock` in main.py already handles the easy case: a lock that leaves
one course with no sections at all. These two functions handle what is left -
constraints that are individually satisfiable but impossible together, and
hard preferences that reject every schedule that does exist.

Both run only after the answer is already "nothing", so neither costs anything
on a successful optimise.
"""

from itertools import combinations
from typing import Any, Dict, List, Optional, Tuple

from optimizer_bundles import BundleChoice, bundle_conflicts

HARD_PREFIX = "hard_"


def mutually_exclusive_pairs(choices: List[BundleChoice]) -> List[Tuple[str, str]]:
    """Course pairs where every option of one clashes with every option of the other.

    Such a pair is a complete and minimal explanation: those two cannot both be
    scheduled whatever else is chosen. A pair with even one surviving
    combination is not the blocker and is deliberately not reported - naming it
    would send a student to change a course that was never the problem.

    Higher-order infeasibility - three courses that pair up fine but cannot all
    coexist - returns an empty list, and the caller says so honestly rather
    than inventing a culprit.
    """
    out: List[Tuple[str, str]] = []
    for a, b in combinations(choices, 2):
        # A course with no options at all is blocked_by_lock's business; it
        # fires earlier and names one course, which is the better message.
        if not a.bundles or not b.bundles:
            continue
        if all(bundle_conflicts(ba, bb) for ba in a.bundles for bb in b.bundles):
            out.append((a.course_code, b.course_code))
    return out


def blocking_hard_rules(breakdowns: List[Dict[str, Any]]) -> List[Dict[str, Optional[str]]]:
    """The hard rules that, between them, rejected every schedule.

    Union rather than intersection, and that is not a shortcut. score_schedule
    returns on the FIRST hard violation it finds (scoring.py:118, :131, :144),
    so each breakdown carries exactly one rule - not every rule that schedule
    breaks. Intersecting would report nothing whenever one schedule trips a
    free day and another trips a cutoff, even though those two rules are
    jointly responsible for there being no results.

    So the honest claim is "every schedule breaks at least one of these", which
    is what the caller's wording says.
    """
    seen: Dict[Tuple[str, Optional[str], Optional[str]], None] = {}
    for bd in breakdowns:
        for p in bd.get("penalties", []):
            kind = p.get("type", "")
            if not kind.startswith(HARD_PREFIX):
                continue
            seen[(kind, p.get("day"), p.get("cutoff"))] = None
    return [
        {"type": kind, "day": day, "cutoff": cutoff}
        for kind, day, cutoff in sorted(seen, key=lambda k: (k[0], k[1] or "", k[2] or ""))
    ]
```

- [ ] **Step 4: Run them and watch them pass**

```bash
cd api && .venv/bin/pytest tests/test_infeasibility.py -q
```

Expected: 11 passed.

- [ ] **Step 5: Confirm nothing else moved**

```bash
cd api && .venv/bin/pytest tests/ -q
```

Expected: **85 passed** — the existing 74 plus these 11.

- [ ] **Step 6: Commit**

```bash
git add api/infeasibility.py api/tests/test_infeasibility.py
git commit -m "feat(api): diagnose why the optimiser returned nothing

Two pure functions over data the caller already has. A mutually exclusive
pair of courses is a complete and minimal explanation for an empty pool;
a pair with one surviving combination is not the blocker and is
deliberately not reported.

The hard-rule side unions rather than intersects, which is forced:
score_schedule returns on the first violation it finds, so each breakdown
carries one rule rather than every rule that schedule breaks. Intersecting
would stay silent whenever one schedule trips a free day and another trips
a cutoff, while both are jointly responsible."
```

---

### Task 2: Report a clash instead of an empty list

**Files:**
- Modify: `api/main.py`
- Test: `api/tests/test_infeasibility_endpoint.py` (create)

**Interfaces:**
- Consumes: `mutually_exclusive_pairs` from Task 1.
- Produces: an `ok: false` response carrying `infeasible_because: "clash"`. Task 3 adds the second value.

After `find_bundle_schedules` returns, an empty `pool` means no combination of the surviving options fits together. Today that falls through to a success response with an empty `results` list, and the frontend shows a toast.

`blocked_by_lock` has already returned by this point if any single course was emptied, so anything reaching here is genuinely a cross-course problem.

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_infeasibility_endpoint.py`:

```python
"""/optimize/ranked says which input made a timetable impossible.

Zero results used to arrive as ok:true with an empty list, which the frontend
showed as a transient toast naming subjects and sections - the wrong thing to
change when the cause was a lock or a hard rule.

Courses are supplied the way every other endpoint test here does it, by
patching _load_courses_with_cache and load_mini_catalog, so nothing reaches
the live WCQ scrape.
"""

import pytest
from fastapi.testclient import TestClient

import main
from models import Course, Meeting, Section


def meeting(day, day_index, start_min, end_min):
    return Meeting(
        day=day, start="09:00AM", end="10:20AM",
        day_index=day_index, start_min=start_min, end_min=end_min,
    )


def lecture(name, class_no, day, day_index, start_min, end_min):
    return Section(
        section=name, class_no=class_no,
        meetings=[meeting(day, day_index, start_min, end_min)],
    )


def client_for(monkeypatch, courses):
    """A TestClient whose optimiser sees exactly `courses` and no catalog."""
    monkeypatch.setattr(main, "_load_courses_with_cache", lambda *a, **k: (courses, [], []))
    monkeypatch.setattr(main, "load_mini_catalog", lambda term: {})
    return TestClient(main.app)


def post(client, **overrides):
    body = {"term": "2610", "course_codes": [], "max_solutions": 6, "prefs": {}}
    body.update(overrides)
    return client.post("/optimize/ranked", json=body).json()


def test_two_courses_that_cannot_coexist_are_named(monkeypatch):
    # Both have exactly one lecture, both Monday 09:00-10:20. Neither course is
    # individually blocked, so blocked_by_lock does not fire and the search
    # runs - and finds nothing.
    courses = {
        "COMP 2011": Course(
            course_code="COMP 2011", title="Programming with C++",
            sections=[lecture("L1", 1001, "Mo", 0, 540, 620)],
        ),
        "MATH 1014": Course(
            course_code="MATH 1014", title="Calculus II",
            sections=[lecture("L1", 2001, "Mo", 0, 540, 620)],
        ),
    }
    client = client_for(monkeypatch, courses)

    data = post(client, course_codes=["COMP 2011", "MATH 1014"])

    assert data["ok"] is False
    assert data["infeasible_because"] == "clash"
    assert "COMP 2011" in data["error"] and "MATH 1014" in data["error"]


def test_courses_that_do_fit_still_succeed(monkeypatch):
    # The guard on the happy path: the diagnosis must not fire when there is
    # an answer.
    courses = {
        "COMP 2011": Course(
            course_code="COMP 2011", title="Programming with C++",
            sections=[lecture("L1", 1001, "Mo", 0, 540, 620)],
        ),
        "MATH 1014": Course(
            course_code="MATH 1014", title="Calculus II",
            sections=[lecture("L1", 2001, "Tu", 1, 540, 620)],
        ),
    }
    client = client_for(monkeypatch, courses)

    data = post(client, course_codes=["COMP 2011", "MATH 1014"])

    assert data["ok"] is True
    assert len(data["results"]) >= 1
    assert "infeasible_because" not in data
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd api && .venv/bin/pytest tests/test_infeasibility_endpoint.py -q
```

Expected: fails on `body["ok"] is False` — today the endpoint returns `ok: true` with an empty `results` list.

- [ ] **Step 3: Return the diagnosis**

In `main.py`, immediately after `pool = find_bundle_schedules(...)`:

```python
    # An empty pool means the surviving options cannot be combined. Say which
    # two courses collide rather than returning an empty list the frontend can
    # only describe in generalities. blocked_by_lock has already returned if
    # any single course was emptied, so this is genuinely cross-course.
    if not pool:
        pairs = mutually_exclusive_pairs(choices)
        if pairs:
            details = "; ".join(
                f"{a} and {b} cannot both be scheduled - every remaining option clashes"
                for a, b in pairs
            )
            error = f"No timetable is possible: {details}."
        else:
            error = (
                "No timetable is possible: your courses cannot all be scheduled "
                "together, though no single pair is the cause. Removing one "
                "course, or relaxing a lock, will show what fits."
            )
        return {
            "ok": False,
            "error": error,
            "infeasible_because": "clash",
            "subjects_fetched": subjects_fetched,
            "cache_misses": cache_misses,
        }
```

Import at the top with the other flat imports:

```python
from infeasibility import blocking_hard_rules, mutually_exclusive_pairs
```

Both are imported now even though `blocking_hard_rules` is Task 3's, so the import line is not edited twice.

- [ ] **Step 4: Run it and watch it pass**

```bash
cd api && .venv/bin/pytest tests/test_infeasibility_endpoint.py -q && .venv/bin/pytest tests/ -q
```

Expected: both new tests pass; the suite is **87** (85 plus these two).

- [ ] **Step 5: Confirm `blocked_by_lock` still wins**

The existing lock tests are the guard. Run them explicitly and say so in the report:

```bash
cd api && .venv/bin/pytest tests/test_optimize_instructor_locks.py tests/test_optimize_section_locks.py -q
```

Expected: unchanged. If any now returns `infeasible_because: "clash"` where it used to name a single course, precedence has broken — stop and report it.

- [ ] **Step 6: Commit**

```bash
git add api/main.py api/tests/test_infeasibility_endpoint.py
git commit -m "feat(api): name the courses that cannot coexist

An empty pool used to arrive as ok:true with an empty list, so the
frontend could only say 'not possible with current subjects/sections'.
It now returns the same ok:false shape blocked_by_lock uses, naming the
pair whose every option clashes - or saying plainly that no single pair
is the cause when the infeasibility is higher-order."
```

---

### Task 3: Report a hard preference that rejected everything

**Files:**
- Modify: `api/main.py`, `web/app/(app)/page.tsx`
- Test: `api/tests/test_infeasibility_endpoint.py` (extend)

**Interfaces:**
- Consumes: `blocking_hard_rules` from Task 1, imported in Task 2.
- Produces: `infeasible_because: "hard_preferences"`.

A non-empty pool filtered to nothing means schedules exist and every one breaks a hard rule. The student's course selection is *fine* — that is the most useful fact available, and the current message actively denies it.

- [ ] **Step 1: Write the failing test**

Append to `api/tests/test_infeasibility_endpoint.py`:

```python
def test_a_hard_rule_that_rejects_everything_is_named(monkeypatch):
    # One course, one lecture, Monday 16:30-17:50. A hard cutoff of 15:00 on
    # Monday rejects the only schedule that exists - so the course list is
    # fine and the rule is the problem.
    courses = {
        "COMP 2011": Course(
            course_code="COMP 2011", title="Programming with C++",
            sections=[lecture("L1", 1001, "Mo", 0, 990, 1070)],
        ),
    }
    client = client_for(monkeypatch, courses)

    data = post(client, course_codes=["COMP 2011"], prefs={"hard_no_after": {"Mo": "15:00"}})

    assert data["ok"] is False
    assert data["infeasible_because"] == "hard_preferences"
    assert "1 timetable" in data["error"]
    assert "15:00" in data["error"] and "Mo" in data["error"]


def test_a_hard_rule_that_rejects_only_some_schedules_is_not_named(monkeypatch):
    # Two lectures, one at 09:00 and one at 16:30, against a 15:00 cutoff. One
    # schedule survives, so there is an answer and no diagnosis at all - naming
    # the cutoff here would send the student to relax a rule that was working.
    courses = {
        "COMP 2011": Course(
            course_code="COMP 2011", title="Programming with C++",
            sections=[
                lecture("L1", 1001, "Mo", 0, 540, 620),
                lecture("L2", 1002, "Mo", 0, 990, 1070),
            ],
        ),
    }
    client = client_for(monkeypatch, courses)

    data = post(client, course_codes=["COMP 2011"], prefs={"hard_no_after": {"Mo": "15:00"}})

    assert data["ok"] is True
    assert len(data["results"]) == 1
    assert "infeasible_because" not in data
```

- [ ] **Step 2: Run it and watch it fail**

Expected: `ok` is `True` today.

- [ ] **Step 3: Collect the rejected breakdowns and return the diagnosis**

The scoring loop currently discards rejected schedules. Keep their breakdowns:

```python
    scored = []
    rejected_breakdowns = []
    for sch in unique_pool:
        s, why = score_schedule(sch, req.prefs)
        if not why.get("rejected"):
            scored.append((s, why, sch))
        else:
            # Kept only to explain a total rejection below; discarded otherwise.
            rejected_breakdowns.append(why)
```

Then, after the loop and before `scored.sort(...)`:

```python
    # Schedules exist and every one breaks a hard rule. The course selection is
    # not the problem, which is the single most useful thing to tell a student
    # here - the old message said the opposite.
    if not scored and rejected_breakdowns:
        rules = blocking_hard_rules(rejected_breakdowns)
        described = "; ".join(_describe_hard_rule(r) for r in rules)
        count = len(rejected_breakdowns)
        noun = "timetable" if count == 1 else "timetables"
        joiner = "breaks" if len(rules) == 1 else "breaks at least one of"
        return {
            "ok": False,
            "error": (
                f"{count} {noun} fit your courses, but every one {joiner}: {described}. "
                "Relax that rule, or make it a soft preference, to see them."
                if len(rules) == 1 else
                f"{count} {noun} fit your courses, but every one {joiner}: {described}. "
                "Relax one of those rules, or make it a soft preference, to see them."
            ),
            "infeasible_because": "hard_preferences",
            "subjects_fetched": subjects_fetched,
            "cache_misses": cache_misses,
        }
```

And a describer beside `_describe_lock`:

```python
def _describe_hard_rule(rule: Dict[str, Optional[str]]) -> str:
    """One hard rule in the words a student set it in."""
    kind, day, cutoff = rule["type"], rule.get("day"), rule.get("cutoff")
    if kind == "hard_free_day_violation":
        return f"{day} must be free"
    if kind == "hard_no_after_violation":
        return f"no classes after {cutoff} on {day}"
    if kind == "hard_no_before_violation":
        return f"no classes before {cutoff} on {day}"
    return kind
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd api && .venv/bin/pytest tests/ -q
```

Expected: **89 passed**.

- [ ] **Step 5: Record that the toast is now a fallback**

In `web/app/(app)/page.tsx`, above the `resultCount === 0` branch:

```tsx
      // The backend now returns ok:false with a specific reason whenever it
      // has nothing to show - a clash it can name, or a hard rule that
      // rejected every schedule - and that renders in the persistent panel
      // above. This branch is the fallback for a path that returns an empty
      // list without one, which should not happen.
```

**Do not change the toast's wording.** It is the project owner's.

- [ ] **Step 6: Verify the web side is untouched otherwise**

```bash
cd web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: 59 vitest, `tsc` clean, eslint at exactly its two pre-existing problems (`prefer-const` in `app/auth/callback/route.ts`, `no-img-element` in `app/login/page.tsx`), build clean with `ƒ Proxy (Middleware)`.

- [ ] **Step 7: Commit**

```bash
git add api/main.py api/tests/test_infeasibility_endpoint.py "web/app/(app)/page.tsx"
git commit -m "feat(api): name the hard rule that rejected every schedule

A pool filtered to nothing means the course selection is fine and a hard
preference is the blocker - the opposite of what the old message said.
The response now reports how many timetables existed before the filter,
which is the most useful fact available, and names the rule to relax.

The toast keeps its wording and becomes a fallback: the backend should
now always return ok:false with a reason when it has nothing to show."
```

---

### Task 4: Verify the feature

**Files:** none — this task changes nothing unless it finds something.

- [ ] **Step 1: Full gate**

```bash
cd api && .venv/bin/pytest tests/ -q
cd ../web && rm -rf .next && ./node_modules/.bin/tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: **89** Python, 59 vitest, `tsc` clean, eslint at its two pre-existing, build clean with `ƒ Proxy (Middleware)`.

- [ ] **Step 2: A successful optimise is unchanged**

The constraint that matters most: diagnosis must not touch the happy path. Compare a successful response against `master`'s for the same request — same keys, same order, same values.

```bash
cd api && .venv/bin/pytest tests/test_optimize_instructor_locks.py tests/test_optimize_section_locks.py tests/test_hard_free_days.py tests/test_scoring_rejection.py -q
```

Expected: unchanged. These four are the suites that exercise the endpoint end to end; if the happy path moved, they are what notices.

- [ ] **Step 3: `blocked_by_lock` still takes precedence**

A course emptied by a lock must still get the single-course message, not a clash. Confirm from the lock suites above and say so explicitly in the report.

- [ ] **Step 4: The negative cases hold**

Re-state the two that guard against a wrong diagnosis, and confirm they pass:

- a partially-conflicting pair is not reported
- a hard rule that rejected only some schedules is not named

These are the difference between a useful message and one that sends a student to change the wrong thing.

- [ ] **Step 5: Report**

No commit unless a step found something. If one did, fix it in its own commit and say which step caught it.
