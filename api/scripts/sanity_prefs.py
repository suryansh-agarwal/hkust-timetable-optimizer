#!/usr/bin/env python3
"""
Minimal sanity tests for Stage 8A scoring prefs.
Run from /api directory: python scripts/sanity_prefs.py
"""

import sys
sys.path.insert(0, ".")

from dataclasses import dataclass
from typing import List, Dict


# Mock Section and Meeting classes to match expected structure
@dataclass
class MockMeeting:
    day: str
    day_index: int
    start_min: int
    end_min: int


@dataclass
class MockSection:
    section: str
    class_no: int
    meetings: List[MockMeeting]


# Mock Weights class
@dataclass
class MockWeights:
    gaps_per_min: float = 0.10
    late_after_per_min: float = 0.50
    early_before_per_min: float = 0.50


# Mock Preferences class
@dataclass
class MockPrefs:
    hard_free_days: List[str]
    hard_no_after: Dict[str, str]
    soft_free_days: List[str]
    soft_no_after: Dict[str, str]
    soft_no_before: Dict[str, str]
    prefer_one_free_day: bool
    compact_days: bool
    weights: MockWeights


from scoring import score_schedule


def test_soft_no_after_penalty():
    """Friday meeting ends at 16:00; soft_no_after Fr=15:00 should penalize 60 minutes over."""
    schedule = {
        "TEST 1000": [
            MockSection(
                section="L1",
                class_no=1001,
                meetings=[
                    MockMeeting(day="Fr", day_index=4, start_min=14*60, end_min=16*60),  # 14:00-16:00
                ],
            )
        ]
    }
    prefs = MockPrefs(
        hard_free_days=[],
        hard_no_after={},
        soft_free_days=[],
        soft_no_after={"Fr": "15:00"},  # cutoff at 15:00 = 900 min
        soft_no_before={},
        prefer_one_free_day=False,
        compact_days=False,
        weights=MockWeights(),
    )

    score, breakdown = score_schedule(schedule, prefs)

    assert not breakdown["rejected"], "Should not be rejected"
    assert any(
        p["type"] == "soft_no_after" and p["day"] == "Fr" and p["minutes_over"] == 60
        for p in breakdown["penalties"]
    ), f"Expected soft_no_after penalty with minutes_over=60, got: {breakdown['penalties']}"

    # Penalty should be -60 * 0.50 = -30
    expected_penalty = -60 * 0.50
    soft_penalty = next(p for p in breakdown["penalties"] if p["type"] == "soft_no_after")
    assert soft_penalty["value"] == expected_penalty, f"Expected {expected_penalty}, got {soft_penalty['value']}"

    print("PASS: test_soft_no_after_penalty")


def test_soft_no_before_penalty():
    """Monday meeting starts at 09:00; soft_no_before Mo=10:00 should penalize 60 minutes under."""
    schedule = {
        "TEST 1000": [
            MockSection(
                section="L1",
                class_no=1001,
                meetings=[
                    MockMeeting(day="Mo", day_index=0, start_min=9*60, end_min=10*60),  # 09:00-10:00
                ],
            )
        ]
    }
    prefs = MockPrefs(
        hard_free_days=[],
        hard_no_after={},
        soft_free_days=[],
        soft_no_after={},
        soft_no_before={"Mo": "10:00"},  # cutoff at 10:00 = 600 min
        prefer_one_free_day=False,
        compact_days=False,
        weights=MockWeights(),
    )

    score, breakdown = score_schedule(schedule, prefs)

    assert not breakdown["rejected"], "Should not be rejected"
    assert any(
        p["type"] == "soft_no_before" and p["day"] == "Mo" and p["minutes_under"] == 60
        for p in breakdown["penalties"]
    ), f"Expected soft_no_before penalty with minutes_under=60, got: {breakdown['penalties']}"

    # Penalty should be -60 * 0.50 = -30
    expected_penalty = -60 * 0.50
    soft_penalty = next(p for p in breakdown["penalties"] if p["type"] == "soft_no_before")
    assert soft_penalty["value"] == expected_penalty, f"Expected {expected_penalty}, got {soft_penalty['value']}"

    print("PASS: test_soft_no_before_penalty")


def test_hard_free_day_rejection():
    """Any meeting on Wednesday; hard_free_days=['We'] should reject with score -1e9."""
    schedule = {
        "TEST 2000": [
            MockSection(
                section="L1",
                class_no=2001,
                meetings=[
                    MockMeeting(day="We", day_index=2, start_min=10*60, end_min=11*60),  # 10:00-11:00
                ],
            )
        ]
    }
    prefs = MockPrefs(
        hard_free_days=["We"],
        hard_no_after={},
        soft_free_days=[],
        soft_no_after={},
        soft_no_before={},
        prefer_one_free_day=False,
        compact_days=False,
        weights=MockWeights(),
    )

    score, breakdown = score_schedule(schedule, prefs)

    assert breakdown["rejected"], "Should be rejected"
    assert score == -1e9, f"Expected score -1e9, got {score}"
    assert any(
        p["type"] == "hard_free_day_violation" and p["day"] == "We"
        for p in breakdown["penalties"]
    ), f"Expected hard_free_day_violation penalty, got: {breakdown['penalties']}"

    print("PASS: test_hard_free_day_rejection")


def test_gaps_penalty_with_weights():
    """Two classes with 30 min gap; compact_days should penalize using weights.gaps_per_min."""
    schedule = {
        "TEST 3000": [
            MockSection(
                section="L1",
                class_no=3001,
                meetings=[
                    MockMeeting(day="Mo", day_index=0, start_min=9*60, end_min=10*60),   # 09:00-10:00
                    MockMeeting(day="Mo", day_index=0, start_min=10*60+30, end_min=11*60+30),  # 10:30-11:30
                ],
            )
        ]
    }
    prefs = MockPrefs(
        hard_free_days=[],
        hard_no_after={},
        soft_free_days=[],
        soft_no_after={},
        soft_no_before={},
        prefer_one_free_day=False,
        compact_days=True,
        weights=MockWeights(gaps_per_min=0.10),
    )

    score, breakdown = score_schedule(schedule, prefs)

    assert not breakdown["rejected"], "Should not be rejected"
    gap_penalty = next((p for p in breakdown["penalties"] if p["type"] == "gaps_minutes"), None)
    assert gap_penalty is not None, "Expected gaps_minutes penalty"
    assert gap_penalty["minutes"] == 30, f"Expected 30 minutes gap, got {gap_penalty['minutes']}"
    # Penalty should be -30 * 0.10 = -3.0
    expected_penalty = -30 * 0.10
    assert gap_penalty["value"] == expected_penalty, f"Expected {expected_penalty}, got {gap_penalty['value']}"

    print("PASS: test_gaps_penalty_with_weights")


if __name__ == "__main__":
    test_soft_no_after_penalty()
    test_soft_no_before_penalty()
    test_hard_free_day_rejection()
    test_gaps_penalty_with_weights()
    print("\nAll sanity tests passed!")

