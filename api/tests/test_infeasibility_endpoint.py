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
