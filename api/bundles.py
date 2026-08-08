from __future__ import annotations
from dataclasses import dataclass
import re
from typing import List, Dict, Any, Optional

from models import Course, Section
from section_utils import section_type
from instructor_filter import lock_is_satisfiable, section_allows


@dataclass
class Bundle:
    course_code: str
    parts: List[Section]  # e.g., [Lec, Tut, Lab]


@dataclass
class MatchingConstraint:
    """Matching constraint for a course."""
    matching_required: bool = False
    matching_type: Optional[str] = None  # "lab" | "tutorial" | "both" | None


def section_num(code: str) -> str | None:
    """Extract the first numeric group from a section code (e.g., L1 -> '1', T1A -> '1')."""
    m = re.search(r"(\d+)", code)
    return m.group(1) if m else None


def build_bundles(
    course: Course,
    constraint: Optional[MatchingConstraint] = None,
    instructor_lock: Optional[str] = None,
) -> List[Bundle]:
    """
    Build all valid bundles for a course.
    
    If constraint.matching_required is True:
    - If matching_type includes "lab": lecture_num must equal lab_num
    - If matching_type includes "tutorial": lecture_num must equal tutorial_num
    - If matching_type is "both": both constraints apply
    
    If no constraint or matching_required is False:
    - Allow full cartesian pairing across lectures/labs/tutorials
    """
    # A lock must be satisfied by a section that actually names the professor.
    # section_allows lets TBA sections through, so without this check a course
    # whose lectures were all filtered out could still produce lab-only
    # bundles via the "no lectures" early return below.
    if not lock_is_satisfiable((s.instructor for s in course.sections), instructor_lock):
        return []

    # Which components a course HAS is a property of the course, not of the
    # lock, so read it from the unfiltered sections. Tutorials and labs are
    # often run by TAs under their own names; deciding "is a tutorial
    # required?" from the post-filter buckets lets a lock empty the bucket and
    # be read as "no tutorial required", producing a timetable that silently
    # omits a required class.
    had_lec = any(section_type(s.section) == "LEC" for s in course.sections)
    had_tut = any(section_type(s.section) == "TUT" for s in course.sections)
    had_lab = any(section_type(s.section) == "LAB" for s in course.sections)

    sections = [s for s in course.sections if section_allows(s.instructor, instructor_lock)]

    lecs, tuts, labs, oth = [], [], [], []
    for s in sections:
        t = section_type(s.section)
        if t == "LEC":
            lecs.append(s)
        elif t == "TUT":
            tuts.append(s)
        elif t == "LAB":
            labs.append(s)
        else:
            oth.append(s)

    # A component that existed before the lock and is empty after it makes the
    # course unschedulable under that lock. Returning [] surfaces it as a
    # blocked lock; falling through would either drop the component or, when
    # the lectures are what went missing, emit lecture-less bundles via the
    # "no lectures" early return below. Without a lock these are all no-ops.
    if (had_lec and not lecs) or (had_tut and not tuts) or (had_lab and not labs):
        return []

    # If no recognized types, treat each section as a standalone bundle
    if not lecs and not tuts and not labs:
        return [Bundle(course.course_code, [s]) for s in sections]

    # If lecs are missing but there are tuts/labs, treat all as standalone (rare)
    if not lecs:
        return [Bundle(course.course_code, [s]) for s in sections]

    # Determine required components
    need_tut = len(tuts) > 0
    need_lab = len(labs) > 0

    # Check if strict matching is required
    strict_matching = bool(constraint and constraint.matching_required)
    match_lab = strict_matching and constraint.matching_type in ("lab", "both")
    match_tutorial = strict_matching and constraint.matching_type in ("tutorial", "both")

    bundles: List[Bundle] = []

    for lec in lecs:
        lec_num = section_num(lec.section)

        if strict_matching:
            # Strict matching: filter by numeric part when required
            if need_tut:
                if match_tutorial and lec_num:
                    candidate_tuts = [t for t in tuts if section_num(t.section) == lec_num]
                else:
                    candidate_tuts = tuts
            else:
                candidate_tuts = [None]

            for tut in candidate_tuts:
                if need_lab:
                    if match_lab and lec_num:
                        candidate_labs = [l for l in labs if section_num(l.section) == lec_num]
                    else:
                        candidate_labs = labs
                else:
                    candidate_labs = [None]

                for lab in candidate_labs:
                    parts = [lec]
                    if tut:
                        parts.append(tut)
                    if lab:
                        parts.append(lab)
                    bundles.append(Bundle(course.course_code, parts))
        else:
            # Non-matching: allow full cartesian pairing
            candidate_tuts = tuts if need_tut else [None]
            candidate_labs = labs if need_lab else [None]

            for tut in candidate_tuts:
                for lab in candidate_labs:
                    parts = [lec]
                    if tut:
                        parts.append(tut)
                    if lab:
                        parts.append(lab)
                    bundles.append(Bundle(course.course_code, parts))

    # If strict matching resulted in no bundles, log warning (shouldn't happen with valid data)
    if not bundles and strict_matching:
        # Fallback: create what we can (this means the WCQ data is inconsistent)
        for lec in lecs:
            bundles.append(Bundle(course.course_code, [lec]))

    # Deduplicate bundles by class_no set (avoid duplicates if pairing was broad)
    seen = set()
    unique: List[Bundle] = []
    for b in bundles:
        key = tuple(sorted(p.class_no for p in b.parts))
        if key not in seen:
            seen.add(key)
            unique.append(b)
    
    return unique


def build_bundles_from_course_data(
    course: Course,
    mini_catalog: Optional[Dict[str, Any]] = None
) -> List[Bundle]:
    """
    Build bundles using mini-catalog metadata for matching constraints.
    
    Args:
        course: The Course object with sections
        mini_catalog: Optional dict mapping course_code -> mini-catalog entry
                     Expected format: {"COMP 2011": {"matching_required": True, "matching_type": "lab"}, ...}
    
    Returns:
        List of valid bundles
    """
    constraint = None
    
    if mini_catalog and course.course_code in mini_catalog:
        entry = mini_catalog[course.course_code]
        constraint = MatchingConstraint(
            matching_required=entry.get("matching_required", False),
            matching_type=entry.get("matching_type")
        )
    
    return build_bundles(course, constraint)
