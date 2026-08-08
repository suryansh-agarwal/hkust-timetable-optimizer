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
    assert data["blocked_by_lock"] == ["COMP 2011"]
    assert "COMP 2011" in data["error"]
    assert "NOBODY, Real" in data["error"]
