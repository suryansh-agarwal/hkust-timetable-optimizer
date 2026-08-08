"""Instructor matching for professor locks.

Two concerns live together here because both hinge on the same definition of
an unnamed instructor: which names the picker offers, and which sections a
lock permits. If they disagreed, a name hidden from the picker could still be
the only thing a lock matched.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

# Exactly the values observed as placeholders in the WCQ catalogue. Widening
# this set would silently make more sections eligible for every lock.
UNNAMED = {"", "TBA"}


def normalise(value: Optional[str]) -> str:
    """Collapse whitespace, strip, uppercase. Returns "" for None."""
    if not value:
        return ""
    return " ".join(str(value).split()).upper()


def is_unnamed(instructor: Optional[str]) -> bool:
    """True when a section names nobody, so no lock should exclude it."""
    return normalise(instructor) in UNNAMED


def section_allows(section_instructor: Optional[str], lock: Optional[str]) -> bool:
    """
    Named-or-TBA: a section is eligible when it names nobody, or when the lock
    appears within its instructor text.

    Substring rather than equality, because WCQ joins co-instructors with no
    delimiter: "KU, Yin Bon LEUNG, Shing Yu".
    """
    if not lock:
        return True
    if is_unnamed(section_instructor):
        return True
    return normalise(lock) in normalise(section_instructor)


def lock_is_satisfiable(instructors: Iterable[Optional[str]], lock: Optional[str]) -> bool:
    """
    True when at least one section actually names the locked professor.

    section_allows lets TBA sections through, so a course can retain sections
    while the professor teaches none of them. That case must be rejected rather
    than silently scheduling a course the student never asked for.
    """
    if not lock:
        return True
    needle = normalise(lock)
    return any(
        not is_unnamed(value) and needle in normalise(value) for value in instructors
    )


def collect_instructors(sections: Iterable[dict[str, Any]]) -> list[str]:
    """Distinct named instructors for a course, in section order, TBA omitted."""
    found: list[str] = []
    for section in sections:
        instructor = section.get("instructor")
        if is_unnamed(instructor):
            continue
        cleaned = " ".join(str(instructor).split())
        if cleaned not in found:
            found.append(cleaned)
    return found
