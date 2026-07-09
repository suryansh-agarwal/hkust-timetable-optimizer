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
    hard_no_before: Dict[str, str]
    soft_free_days: List[str]
    soft_no_after: Dict[str, str]
    soft_no_before: Dict[str, str]
    prefer_one_free_day: bool
    gap_shape: str
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
        hard_no_before={},
        soft_free_days=[],
        soft_no_after={"Fr": "15:00"},  # cutoff at 15:00 = 900 min
        soft_no_before={},
        prefer_one_free_day=False,
        gap_shape="no_preference",
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
        hard_no_before={},
        soft_free_days=[],
        soft_no_after={},
        soft_no_before={"Mo": "10:00"},  # cutoff at 10:00 = 600 min
        prefer_one_free_day=False,
        gap_shape="no_preference",
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
        hard_no_before={},
        soft_free_days=[],
        soft_no_after={},
        soft_no_before={},
        prefer_one_free_day=False,
        gap_shape="no_preference",
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


def _schedule_with_gaps(gap_minutes_list):
    """Build a schedule of 30-min classes on Mo (starting 09:00) separated by the given gaps.

    gap_minutes_list has one entry per gap, so it produces len(gap_minutes_list) + 1 classes.
    """
    meetings = []
    cursor = 9 * 60
    meetings.append(MockMeeting(day="Mo", day_index=0, start_min=cursor, end_min=cursor + 30))
    cursor += 30
    for gap in gap_minutes_list:
        cursor += gap
        meetings.append(MockMeeting(day="Mo", day_index=0, start_min=cursor, end_min=cursor + 30))
        cursor += 30
    return {
        "TEST 3000": [MockSection(section="L1", class_no=3001, meetings=meetings)]
    }


def _score_with_shape(schedule, gap_shape):
    prefs = MockPrefs(
        hard_free_days=[],
        hard_no_after={},
        hard_no_before={},
        soft_free_days=[],
        soft_no_after={},
        soft_no_before={},
        prefer_one_free_day=False,
        gap_shape=gap_shape,
        weights=MockWeights(gaps_per_min=0.10),
    )
    return score_schedule(schedule, prefs)


def test_gaps_penalty_no_preference_matches_linear_sum():
    """Two classes with 30 min gap; no_preference should penalize using weights.gaps_per_min (today's linear behavior)."""
    schedule = _schedule_with_gaps([30])
    score, breakdown = _score_with_shape(schedule, "no_preference")

    assert not breakdown["rejected"], "Should not be rejected"
    gap_penalty = next((p for p in breakdown["penalties"] if p["type"] == "gaps_minutes"), None)
    assert gap_penalty is not None, "Expected gaps_minutes penalty"
    assert gap_penalty["minutes"] == 30, f"Expected 30 minutes gap, got {gap_penalty['minutes']}"
    # Penalty should be -30 * 0.10 = -3.0
    expected_penalty = -30 * 0.10
    assert gap_penalty["value"] == expected_penalty, f"Expected {expected_penalty}, got {gap_penalty['value']}"

    print("PASS: test_gaps_penalty_no_preference_matches_linear_sum")


def test_gaps_penalty_consolidated_prefers_one_long_gap():
    """One 180-min gap should score better (less negative) than three 60-min gaps under 'consolidated'."""
    one_long = _schedule_with_gaps([180])
    three_short = _schedule_with_gaps([60, 60, 60])

    score_long, _ = _score_with_shape(one_long, "consolidated")
    score_short, _ = _score_with_shape(three_short, "consolidated")

    assert score_long > score_short, (
        f"Expected one long gap to score higher under 'consolidated', "
        f"got long={score_long}, short={score_short}"
    )

    print("PASS: test_gaps_penalty_consolidated_prefers_one_long_gap")


def test_gaps_penalty_fragmented_prefers_short_gaps():
    """Three 60-min gaps should score better (less negative) than one 180-min gap under 'fragmented'."""
    one_long = _schedule_with_gaps([180])
    three_short = _schedule_with_gaps([60, 60, 60])

    score_long, _ = _score_with_shape(one_long, "fragmented")
    score_short, _ = _score_with_shape(three_short, "fragmented")

    assert score_short > score_long, (
        f"Expected several short gaps to score higher under 'fragmented', "
        f"got long={score_long}, short={score_short}"
    )

    print("PASS: test_gaps_penalty_fragmented_prefers_short_gaps")


def test_gaps_penalty_zero_gap_is_zero_under_all_shapes():
    """Back-to-back classes (no gap) should contribute 0 penalty regardless of shape."""
    schedule = _schedule_with_gaps([0])
    for shape in ("no_preference", "consolidated", "fragmented"):
        _, breakdown = _score_with_shape(schedule, shape)
        gap_penalty = next((p for p in breakdown["penalties"] if p["type"] == "gaps_minutes"), None)
        assert gap_penalty is not None, f"Expected gaps_minutes penalty entry for shape={shape}"
        assert gap_penalty["minutes"] == 0, f"Expected 0 minutes for shape={shape}, got {gap_penalty['minutes']}"
        assert gap_penalty["value"] == 0, f"Expected 0 value for shape={shape}, got {gap_penalty['value']}"

    print("PASS: test_gaps_penalty_zero_gap_is_zero_under_all_shapes")


if __name__ == "__main__":
    test_soft_no_after_penalty()
    test_soft_no_before_penalty()
    test_hard_free_day_rejection()
    test_gaps_penalty_no_preference_matches_linear_sum()
    test_gaps_penalty_consolidated_prefers_one_long_gap()
    test_gaps_penalty_fragmented_prefers_short_gaps()
    test_gaps_penalty_zero_gap_is_zero_under_all_shapes()
    print("\nAll sanity tests passed!")

