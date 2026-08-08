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


def _matches_at_boundary(haystack: str, needle: str) -> bool:
    """
    True when needle occurs in haystack delimited by non-alphanumerics.

    Substring rather than equality, because WCQ joins co-instructors with no
    delimiter: "KU, Yin Bon LEUNG, Shing Yu" must match either name. Bare
    substring, though, cross-matches distinct people - "LU, Yang" is a
    substring of "LU, Yanglong", and both teach in 2610. Requiring the match
    to start at position 0 or after a non-alphanumeric, and to end at the end
    of the string or before a non-alphanumeric, separates the two without
    breaking the joined-cell case (the join is a space).
    """
    if not needle:
        return False
    start = haystack.find(needle)
    while start != -1:
        end = start + len(needle)
        starts_clean = start == 0 or not haystack[start - 1].isalnum()
        ends_clean = end == len(haystack) or not haystack[end].isalnum()
        if starts_clean and ends_clean:
            return True
        start = haystack.find(needle, start + 1)
    return False


def section_allows(section_instructor: Optional[str], lock: Optional[str]) -> bool:
    """
    Named-or-TBA: a section is eligible when it names nobody, or when the lock
    appears within its instructor text on name boundaries.

    A lock that normalises to empty (None, "", or whitespace only) is no lock.
    Testing `lock` alone would let " " through, and "" is a substring of every
    instructor, so a whitespace lock would match everything.
    """
    needle = normalise(lock)
    if not needle:
        return True
    if is_unnamed(section_instructor):
        return True
    return _matches_at_boundary(normalise(section_instructor), needle)


def lock_is_satisfiable(instructors: Iterable[Optional[str]], lock: Optional[str]) -> bool:
    """
    True when at least one section actually names the locked professor.

    section_allows lets TBA sections through, so a course can retain sections
    while the professor teaches none of them. That case must be rejected rather
    than silently scheduling a course the student never asked for.
    """
    needle = normalise(lock)
    if not needle:
        return True
    return any(
        not is_unnamed(value) and _matches_at_boundary(normalise(value), needle)
        for value in instructors
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
