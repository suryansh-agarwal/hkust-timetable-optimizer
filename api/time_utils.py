from __future__ import annotations

import re

DAY_TO_INDEX = {"Mo": 0, "Tu": 1, "We": 2, "Th": 3, "Fr": 4, "Sa": 5, "Su": 6}

TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})(AM|PM)$")


def to_minutes(t: str) -> int:
    """
    Convert '10:30AM' -> minutes since midnight.
    """
    t = t.strip().upper()
    m = TIME_RE.match(t)
    if not m:
        raise ValueError(f"Bad time format: {t}")

    hh = int(m.group(1))
    mm = int(m.group(2))
    ampm = m.group(3)

    if hh == 12:
        hh = 0
    if ampm == "PM":
        hh += 12

    return hh * 60 + mm


def day_index(day: str) -> int:
    day = day.strip()
    if day not in DAY_TO_INDEX:
        raise ValueError(f"Bad day token: {day}")
    return DAY_TO_INDEX[day]
