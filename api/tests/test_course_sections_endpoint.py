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
