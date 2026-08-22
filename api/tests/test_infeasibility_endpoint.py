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
            course_code="COMP 2011", title="Programming with C++", units=4,
            sections=[lecture("L1", 1001, "Mo", 0, 540, 620)],
        ),
        "MATH 1014": Course(
            course_code="MATH 1014", title="Calculus II", units=4,
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
            course_code="COMP 2011", title="Programming with C++", units=4,
            sections=[lecture("L1", 1001, "Mo", 0, 540, 620)],
        ),
        "MATH 1014": Course(
            course_code="MATH 1014", title="Calculus II", units=4,
            sections=[lecture("L1", 2001, "Tu", 1, 540, 620)],
        ),
    }
    client = client_for(monkeypatch, courses)

    data = post(client, course_codes=["COMP 2011", "MATH 1014"])

    assert data["ok"] is True
    assert len(data["results"]) >= 1
    assert "infeasible_because" not in data


def test_a_hard_rule_that_rejects_everything_is_named(monkeypatch):
    # One course, one lecture, Monday 16:30-17:50. A hard cutoff of 15:00 on
    # Monday rejects the only schedule that exists - so the course list is
    # fine and the rule is the problem.
    courses = {
        "COMP 2011": Course(
            course_code="COMP 2011", title="Programming with C++", units=4,
            sections=[lecture("L1", 1001, "Mo", 0, 990, 1070)],
        ),
    }
    client = client_for(monkeypatch, courses)

    data = post(client, course_codes=["COMP 2011"], prefs={"hard_no_after": {"Mo": "15:00"}})

    assert data["ok"] is False
    assert data["infeasible_because"] == "hard_preferences"
    # Pinned to the verb agreeing with the count: "1 timetable fits", not the
    # pluralised-noun-only "1 timetable fit" the message used to produce.
    assert "1 timetable fits your courses" in data["error"]
    assert "15:00" in data["error"] and "Mo" in data["error"]


def test_a_hard_rule_that_rejects_only_some_schedules_is_not_named(monkeypatch):
    # Two lectures, one at 09:00 and one at 16:30, against a 15:00 cutoff. One
    # schedule survives, so there is an answer and no diagnosis at all - naming
    # the cutoff here would send the student to relax a rule that was working.
    courses = {
        "COMP 2011": Course(
            course_code="COMP 2011", title="Programming with C++", units=4,
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


def test_two_different_rules_are_both_named(monkeypatch):
    # One course, two sections. L1 meets Monday, which a hard free day on Mo
    # rejects outright. L2 meets Tuesday 10:30-11:50, which a hard no-after
    # cutoff of 10:00 on Tu rejects. No single schedule trips both rules -
    # each rejected breakdown carries exactly one, since score_schedule
    # returns on the first violation it finds - so this is only detectable
    # because blocking_hard_rules unions across breakdowns instead of
    # intersecting. If it intersected, the two per-schedule rule sets
    # ({hard_free_day_violation} and {hard_no_after_violation}) share nothing,
    # the result would be empty, and this test would fail.
    courses = {
        "COMP 2011": Course(
            course_code="COMP 2011", title="Programming with C++", units=4,
            sections=[
                lecture("L1", 1001, "Mo", 0, 540, 620),
                lecture("L2", 1002, "Tu", 1, 630, 710),
            ],
        ),
    }
    client = client_for(monkeypatch, courses)

    data = post(
        client,
        course_codes=["COMP 2011"],
        prefs={"hard_free_days": ["Mo"], "hard_no_after": {"Tu": "10:00"}},
    )

    assert data["ok"] is False
    assert data["infeasible_because"] == "hard_preferences"
    assert "at least one of" in data["error"]
    assert "Mo must be free" in data["error"]
    assert "no classes after 10:00 on Tu" in data["error"]


def test_a_truncated_pool_hedges_instead_of_accusing_the_rule(monkeypatch):
    # One course, two Monday lectures: L1 16:30-17:50 (breaks a 15:00 cutoff)
    # and L2 09:00-10:20 (satisfies it). Listed in that order so the DFS in
    # find_bundle_schedules - which iterates a course's bundles in the order
    # build_bundles produced them, i.e. course.sections order here - tries L1
    # first. With search_limit and max_solutions both 1, the cap is reached
    # after that first (violating) schedule, so the search never gets to
    # L2, which would have satisfied the rule. The old wording asserted
    # "every one breaks" about that one-schedule sample as though it were the
    # whole solution set - false, since L2 exists and was never examined.
    courses = {
        "COMP 2011": Course(
            course_code="COMP 2011", title="Programming with C++", units=4,
            sections=[
                lecture("L1", 1001, "Mo", 0, 990, 1070),
                lecture("L2", 1002, "Mo", 0, 540, 620),
            ],
        ),
    }
    client = client_for(monkeypatch, courses)

    data = post(
        client,
        course_codes=["COMP 2011"],
        max_solutions=1,
        search_limit=1,
        prefs={"hard_no_after": {"Mo": "15:00"}},
    )

    assert data["ok"] is False
    assert data["infeasible_because"] == "hard_preferences"
    assert "the first" in data["error"]
    assert "past our search limit" in data["error"]
    # The old, non-truncated phrasing must not appear: it asserts a universal
    # that this sample cannot support.
    assert "fits your courses" not in data["error"]
    assert "fit your courses" not in data["error"]


def test_missing_course_codes_are_labelled_missing(monkeypatch):
    # infeasible_because must be switchable across all four failure shapes,
    # not just the two added by this feature - the two pre-existing shapes
    # (missing courses, a blocked lock) carried no key at all.
    courses = {}
    client = client_for(monkeypatch, courses)

    data = post(client, course_codes=["COMP 9999"])

    assert data["ok"] is False
    assert data["infeasible_because"] == "missing"
    assert data["missing"] == ["COMP 9999"]
    # The error string itself is asserted elsewhere in the suite as an
    # existing contract; only confirm this change did not touch it.
    assert data["error"] == "Course codes not found"


def test_a_blocked_lock_is_labelled_lock(monkeypatch):
    courses = {
        "COMP 2011": Course(
            course_code="COMP 2011", title="Programming with C++", units=4,
            sections=[
                Section(
                    section="L1", class_no=1001, instructor="SMITH, John",
                    meetings=[Meeting(day="Mo", start="09:00AM", end="10:20AM",
                                       day_index=0, start_min=540, end_min=620)],
                ),
            ],
        ),
    }
    client = client_for(monkeypatch, courses)

    data = post(
        client,
        course_codes=["COMP 2011"],
        instructor_locks={"COMP 2011": "JONES"},
    )

    assert data["ok"] is False
    assert data["infeasible_because"] == "lock"
    assert data["blocked_by_lock"] == ["COMP 2011"]


def test_no_single_pair_is_the_cause_is_labelled_unknown(monkeypatch):
    # Three courses, each with two non-overlapping Monday slots. Every pair
    # has a surviving combination (put each course in a different slot), so
    # mutually_exclusive_pairs reports nothing - but with only two slots for
    # three courses, no full assignment avoids a clash, so the pool is empty.
    # This is the higher-order case infeasibility.py's own docstring
    # describes, and the spec defines "unknown" for exactly it; the pre-fix
    # code mislabelled it "clash" while the message itself said otherwise.
    def two_slots(prefix, n1, n2):
        return [
            lecture("L1", n1, "Mo", 0, 540, 620),   # 09:00-10:20
            lecture("L2", n2, "Mo", 0, 630, 710),   # 10:30-11:50
        ]

    courses = {
        "COMP 2011": Course(course_code="COMP 2011", title="A", units=4,
                             sections=two_slots("A", 1001, 1002)),
        "MATH 1014": Course(course_code="MATH 1014", title="B", units=4,
                             sections=two_slots("B", 2001, 2002)),
        "PHYS 1002": Course(course_code="PHYS 1002", title="C", units=4,
                             sections=two_slots("C", 3001, 3002)),
    }
    client = client_for(monkeypatch, courses)

    data = post(client, course_codes=["COMP 2011", "MATH 1014", "PHYS 1002"])

    assert data["ok"] is False
    assert data["infeasible_because"] == "unknown"
    assert "no single pair is the cause" in data["error"]


def test_max_solutions_and_search_limit_reject_non_positive(monkeypatch):
    courses = {
        "COMP 2011": Course(
            course_code="COMP 2011", title="Programming with C++", units=4,
            sections=[lecture("L1", 1001, "Mo", 0, 540, 620)],
        ),
    }
    client = client_for(monkeypatch, courses)

    resp = client.post("/optimize/ranked", json={
        "term": "2610", "course_codes": ["COMP 2011"], "max_solutions": 0, "prefs": {},
    })
    assert resp.status_code == 422

    resp = client.post("/optimize/ranked", json={
        "term": "2610", "course_codes": ["COMP 2011"], "search_limit": 0, "prefs": {},
    })
    assert resp.status_code == 422

    resp = client.post("/optimize/ranked", json={
        "term": "2610", "course_codes": ["COMP 2011"], "max_solutions": -3, "prefs": {},
    })
    assert resp.status_code == 422
