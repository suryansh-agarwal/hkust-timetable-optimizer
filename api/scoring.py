from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Tuple, Any

from models import Section

DAY_ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

def hhmm_to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)

def all_meetings(schedule: Dict[str, List[Section]]) -> List[dict]:
    out = []
    for course_code, parts in schedule.items():
        for sec in parts:
            for mtg in sec.meetings:
                out.append({
                    "course_code": course_code,
                    "section": sec.section,
                    "day": mtg.day,
                    "day_index": mtg.day_index,
                    "start_min": mtg.start_min,
                    "end_min": mtg.end_min,
                })
    return out

def day_has_class(meetings, day: str) -> bool:
    return any(m["day"] == day for m in meetings)

def violates_free_day(meetings, day: str) -> bool:
    return day_has_class(meetings, day)

def violates_no_after(meetings, day: str, cutoff_min: int) -> bool:
    # violation if any class starts OR ends after cutoff (choose stricter end-based)
    return any(m["day"] == day and m["end_min"] > cutoff_min for m in meetings)

def gaps_penalty(meetings) -> int:
    # sum of idle minutes between classes on same day (penalty)
    penalty = 0
    by_day = {}
    for m in meetings:
        by_day.setdefault(m["day"], []).append(m)
    for day, ms in by_day.items():
        ms.sort(key=lambda x: x["start_min"])
        for a, b in zip(ms, ms[1:]):
            gap = b["start_min"] - a["end_min"]
            if gap > 0:
                penalty += gap
    return penalty

def count_free_days(meetings) -> int:
    weekdays = ["Mo", "Tu", "We", "Th", "Fr"]
    return sum(1 for d in weekdays if not day_has_class(meetings, d))

def compute_minutes_over(meetings, day: str, cutoff_min: int) -> int:
    """Sum of minutes each meeting on `day` ends after `cutoff_min`."""
    total = 0
    for m in meetings:
        if m["day"] == day and m["end_min"] > cutoff_min:
            total += m["end_min"] - cutoff_min
    return total


def compute_minutes_under(meetings, day: str, cutoff_min: int) -> int:
    """Sum of minutes each meeting on `day` starts before `cutoff_min`."""
    total = 0
    for m in meetings:
        if m["day"] == day and m["start_min"] < cutoff_min:
            total += cutoff_min - m["start_min"]
    return total


def score_schedule(schedule: Dict[str, List[Section]], prefs) -> Tuple[float, Dict[str, Any]]:
    ms = all_meetings(schedule)
    weights = prefs.weights

    # --- hard constraints ---
    score = 0.0
    breakdown = {"rejected": False, "bonuses": [], "penalties": []}

    # Hard free days: apply moderate penalties to keep scores comparable
    for d in prefs.hard_free_days:
        if violates_free_day(ms, d):
            penalty_val = -200
            breakdown["penalties"].append({
                "type": "hard_free_day_violation",
                "day": d,
                "value": penalty_val,
            })
            # Penalize but do not reject the schedule
            # to keep results comparable.
            score += penalty_val

    # Hard no-after cutoffs
    for d, hhmm in prefs.hard_no_after.items():
        cut = hhmm_to_min(hhmm)
        if violates_no_after(ms, d, cut):
            breakdown["rejected"] = True
            breakdown["penalties"].append({
                "type": "hard_no_after_violation",
                "day": d,
                "cutoff": hhmm,
                "value": -999999,
            })
            return -1e9, breakdown

    # --- scoring (higher is better) ---

    # soft free days
    for d in prefs.soft_free_days:
        if violates_free_day(ms, d):
            score -= 200
            breakdown["penalties"].append({"type": "soft_free_day", "day": d, "value": -200})
        else:
            score += 50
            breakdown["bonuses"].append({"type": "soft_free_day", "day": d, "value": +50})

    # soft no-after cutoffs (multi-day, minute-based penalty)
    for d, hhmm in prefs.soft_no_after.items():
        cut = hhmm_to_min(hhmm)
        minutes_over = compute_minutes_over(ms, d, cut)
        if minutes_over > 0:
            penalty_value = -minutes_over * weights.late_after_per_min
            score += penalty_value
            breakdown["penalties"].append({
                "type": "soft_no_after",
                "day": d,
                "cutoff": hhmm,
                "minutes_over": minutes_over,
                "value": penalty_value,
            })

    # soft no-before cutoffs (multi-day, minute-based penalty)
    for d, hhmm in prefs.soft_no_before.items():
        cut = hhmm_to_min(hhmm)
        minutes_under = compute_minutes_under(ms, d, cut)
        if minutes_under > 0:
            penalty_value = -minutes_under * weights.early_before_per_min
            score += penalty_value
            breakdown["penalties"].append({
                "type": "soft_no_before",
                "day": d,
                "cutoff": hhmm,
                "minutes_under": minutes_under,
                "value": penalty_value,
            })

    # prefer one free weekday
    if prefs.prefer_one_free_day:
        free = count_free_days(ms)
        # reward more free days, but diminishing
        score += min(free, 2) * 120
        breakdown["bonuses"].append({"type": "free_days", "count": free, "value": min(free, 2) * 120})

    # compact days (minimize gaps) - use weights.gaps_per_min
    if prefs.compact_days:
        gp = gaps_penalty(ms)
        penalty_value = -gp * weights.gaps_per_min
        score += penalty_value
        breakdown["penalties"].append({"type": "gaps_minutes", "minutes": gp, "value": penalty_value})

    return score, breakdown
