"""Hard constraints must actually remove schedules, not merely rank them last.

`score_schedule` marks a rejected schedule with `breakdown["rejected"]` and
returns a large negative sentinel. `/optimize/ranked` used to filter on
`s != float("-inf")` while the sentinel was `-1e9`, so nothing was ever
excluded: a student whose hard cutoff was impossible got six schedules that
all violated it instead of being told no timetable exists.
"""

import pytest
from fastapi.testclient import TestClient

import main
from models import Course, Meeting, Section
from scoring import score_schedule


def meeting(day, day_index, start_min, end_min):
    return Meeting(
        day=day,
        start="10:30AM",
        end="11:50AM",
        day_index=day_index,
        start_min=start_min,
        end_min=end_min,
    )


# A single lecture on Monday 10:30-11:50.
MON_LECTURE = Section(
    section="L1",
    class_no=1,
    instructor="LI, Xin",
    meetings=[meeting("Mo", 0, 630, 710)],
)


@pytest.fixture
def client(monkeypatch):
    course = Course(
        course_code="COMP 2011",
        title="Programming with C++",
        units=4,
        sections=[MON_LECTURE],
    )
    monkeypatch.setattr(
        main, "_load_courses_with_cache", lambda *a, **k: ({"COMP 2011": course}, [], [])
    )
    monkeypatch.setattr(main, "load_mini_catalog", lambda term: {})
    return TestClient(main.app)


def post(client, prefs):
    body = {
        "term": "2610",
        "course_codes": ["COMP 2011"],
        "max_solutions": 10,
        "prefs": prefs,
    }
    return client.post("/optimize/ranked", json=body).json()


def test_score_schedule_marks_a_hard_cutoff_violation_as_rejected():
    schedule = {"COMP 2011": [MON_LECTURE]}
    _, breakdown = score_schedule(
        schedule, main.Preferences(hard_no_after={"Mo": "09:00"})
    )
    assert breakdown["rejected"] is True


def test_an_impossible_hard_no_after_returns_no_results(client):
    # The only lecture ends at 11:50, so a 09:00 cutoff cannot be met.
    # /optimize/ranked now diagnoses this rather than returning an empty
    # ok:True list - see test_infeasibility_endpoint.py for the message.
    data = post(client, {"hard_no_after": {"Mo": "09:00"}})
    assert data["ok"] is False
    assert data["infeasible_because"] == "hard_preferences"
    assert "results" not in data


def test_an_impossible_hard_no_before_returns_no_results(client):
    # The only lecture starts at 10:30, so a 14:00 no-before cannot be met.
    data = post(client, {"hard_no_before": {"Mo": "14:00"}})
    assert data["ok"] is False
    assert data["infeasible_because"] == "hard_preferences"


def test_a_satisfiable_hard_cutoff_still_returns_the_schedule(client):
    # 18:00 is comfortably after the 11:50 finish - nothing to reject.
    data = post(client, {"hard_no_after": {"Mo": "18:00"}})
    assert len(data["results"]) == 1
    assert data["results"][0]["breakdown"]["rejected"] is False


def test_no_hard_constraints_is_unaffected(client):
    data = post(client, {})
    assert len(data["results"]) == 1
