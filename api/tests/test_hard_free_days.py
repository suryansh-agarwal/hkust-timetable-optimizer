"""A hard free day must be a hard constraint.

It used to apply a flat -200 penalty and keep the schedule. A soft free day
applies the same -200 when violated AND a +50 bonus when satisfied, so "hard"
was in fact the weaker of the two settings: it could never earn the bonus and
could always be traded away.
"""

import pytest
from fastapi.testclient import TestClient

import main
from models import Course, Meeting, Section
from scoring import REJECTED_SCORE, score_schedule


def meeting(day, day_index):
    return Meeting(
        day=day,
        start="10:30AM",
        end="11:50AM",
        day_index=day_index,
        start_min=630,
        end_min=710,
    )


MON_LECTURE = Section(
    section="L1", class_no=1, instructor="LI, Xin", meetings=[meeting("Mo", 0)]
)
TUE_LECTURE = Section(
    section="L2", class_no=2, instructor="CHAN, Cecia Ki", meetings=[meeting("Tu", 1)]
)


@pytest.fixture
def client(monkeypatch):
    course = Course(
        course_code="COMP 2011",
        title="Programming with C++",
        units=4,
        sections=[MON_LECTURE, TUE_LECTURE],
    )
    monkeypatch.setattr(
        main, "_load_courses_with_cache", lambda *a, **k: ({"COMP 2011": course}, [], [])
    )
    monkeypatch.setattr(main, "load_mini_catalog", lambda term: {})
    return TestClient(main.app)


def post(client, prefs):
    return client.post(
        "/optimize/ranked",
        json={
            "term": "2610",
            "course_codes": ["COMP 2011"],
            "max_solutions": 10,
            "prefs": prefs,
        },
    ).json()


def sections_returned(data):
    return {
        part["section"]
        for result in data["results"]
        for course in result["schedule"]
        for part in course["parts"]
    }


def test_a_violated_hard_free_day_is_rejected():
    schedule = {"COMP 2011": [MON_LECTURE]}
    score, breakdown = score_schedule(schedule, main.Preferences(hard_free_days=["Mo"]))
    assert breakdown["rejected"] is True
    assert score == REJECTED_SCORE


def test_a_satisfied_hard_free_day_is_not_rejected():
    schedule = {"COMP 2011": [TUE_LECTURE]}
    _, breakdown = score_schedule(schedule, main.Preferences(hard_free_days=["Mo"]))
    assert breakdown["rejected"] is False
    assert not any(
        p["type"] == "hard_free_day_violation" for p in breakdown["penalties"]
    )


def test_a_hard_free_day_removes_the_offending_schedule(client):
    # Only the Tuesday lecture can survive a hard-free Monday.
    data = post(client, {"hard_free_days": ["Mo"]})
    assert data["ok"] is True
    assert sections_returned(data) == {"L2"}


def test_an_impossible_hard_free_day_returns_no_results(client):
    # Every section of the course meets on Mo or Tu, so freeing both is impossible.
    # /optimize/ranked now diagnoses this rather than returning an empty
    # ok:True list - see test_infeasibility_endpoint.py for the message.
    data = post(client, {"hard_free_days": ["Mo", "Tu"]})
    assert data["ok"] is False
    assert data["infeasible_because"] == "hard_preferences"


def test_a_soft_free_day_still_only_penalises(client):
    # Soft must keep both options and merely rank the Monday one lower.
    data = post(client, {"soft_free_days": ["Mo"]})
    assert sections_returned(data) == {"L1", "L2"}
    best = data["results"][0]
    assert best["schedule"][0]["parts"][0]["section"] == "L2"


def test_hard_is_at_least_as_strong_as_soft(client):
    hard = post(client, {"hard_free_days": ["Mo"]})
    soft = post(client, {"soft_free_days": ["Mo"]})
    assert len(hard["results"]) < len(soft["results"])
