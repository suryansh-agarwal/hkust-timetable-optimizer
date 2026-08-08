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


def test_blocked_message_names_both_lecture_and_tutorial_pins(client):
    data = post(
        client,
        section_locks={"MATH 1003": {"lecture": "L1", "tutorial": "T9Z"}},
    )
    assert data["ok"] is False
    assert data["blocked_by_lock"] == ["MATH 1003"]
    assert "lecture" in data["error"]
    assert "L1" in data["error"]
    assert "tutorial" in data["error"]
    assert "T9Z" in data["error"]


@pytest.fixture
def empty_client(monkeypatch):
    # A course with zero sections is legitimately unschedulable regardless of
    # any lock: build_bundles returns [] for it no matter what. This isolates
    # "the course has no schedule" from "a pin blocked the course" so that an
    # empty-valued section_locks entry (e.g. {"lecture": ""}) can be checked
    # against has_pin's definition of "not actually a pin" rather than being
    # misattributed to blocked_by_lock.
    course = Course(
        course_code="MATH 1003",
        title="Calculus and Linear Algebra",
        units=3,
        sections=[],
    )
    monkeypatch.setattr(
        main, "_load_courses_with_cache", lambda *a, **k: ({"MATH 1003": course}, [], [])
    )
    monkeypatch.setattr(main, "load_mini_catalog", lambda term: {})
    return TestClient(main.app)


def test_empty_valued_pin_is_not_reported_as_the_blocker(empty_client):
    # {"lecture": ""} is not a real pin (has_pin says so), so even though this
    # course has no possible schedule, that must not be attributed to a lock.
    data = post(empty_client, section_locks={"MATH 1003": {"lecture": ""}})
    assert "blocked_by_lock" not in data or "MATH 1003" not in data["blocked_by_lock"]
