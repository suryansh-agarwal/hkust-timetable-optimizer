from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

from models import Course, Section
from section_utils import section_type, group_key


@dataclass
class Bundle:
    course_code: str
    parts: List[Section]  # e.g., [Lec, Tut, Lab]


@dataclass
class MatchingConstraint:
    """Matching constraint for a course."""
    matching_required: bool = False
    matching_type: Optional[str] = None  # "lab" | "tutorial" | "both" | None


def build_bundles(
    course: Course, 
    constraint: Optional[MatchingConstraint] = None
) -> List[Bundle]:
    """
    Build all valid bundles for a course.
    
    If constraint.matching_required is True:
    - If matching_type includes "lab": lecture_num must equal lab_num
    - If matching_type includes "tutorial": lecture_num must equal tutorial_num
    - If matching_type is "both": both constraints apply
    
    If no constraint or matching_required is False:
    - Try to pair by group_key (best effort)
    - Fall back to all combinations if no pairing info
    """
    lecs, tuts, labs, oth = [], [], [], []
    for s in course.sections:
        t = section_type(s.section)
        if t == "LEC":
            lecs.append(s)
        elif t == "TUT":
            tuts.append(s)
        elif t == "LAB":
            labs.append(s)
        else:
            oth.append(s)

    # If no recognized types, treat each section as a standalone bundle
    if not lecs and not tuts and not labs:
        return [Bundle(course.course_code, [s]) for s in course.sections]

    # If lecs are missing but there are tuts/labs, treat all as standalone (rare)
    if not lecs:
        return [Bundle(course.course_code, [s]) for s in course.sections]

    # Determine required components
    need_tut = len(tuts) > 0
    need_lab = len(labs) > 0

    # Check if strict matching is required
    strict_matching = constraint and constraint.matching_required
    match_lab = strict_matching and constraint.matching_type in ("lab", "both")
    match_tutorial = strict_matching and constraint.matching_type in ("tutorial", "both")

    bundles: List[Bundle] = []

    # Build section maps by group key
    tuts_by_key: Dict[str, List[Section]] = {}
    for t in tuts:
        k = group_key(t.section)
        if k:
            tuts_by_key.setdefault(k, []).append(t)

    labs_by_key: Dict[str, List[Section]] = {}
    for lb in labs:
        k = group_key(lb.section)
        if k:
            labs_by_key.setdefault(k, []).append(lb)

    for lec in lecs:
        lec_key = group_key(lec.section)
        
        # Determine which tutorials can pair with this lecture
        if need_tut:
            if match_tutorial and lec_key:
                # Strict matching: only tutorials with same number
                candidate_tuts = tuts_by_key.get(lec_key, [])
            else:
                # Best effort: prefer matching key, but allow all if no match
                candidate_tuts = tuts_by_key.get(lec_key, []) if lec_key else []
                if not candidate_tuts:
                    candidate_tuts = tuts
        else:
            candidate_tuts = [None]
        
        for tut in candidate_tuts:
            tut_key = group_key(tut.section) if tut else None
            
            # Determine which labs can pair with this lecture/tutorial
            if need_lab:
                if match_lab and lec_key:
                    # Strict matching: only labs with same number as lecture
                    candidate_labs = labs_by_key.get(lec_key, [])
                else:
                    # Best effort: prefer matching key (tutorial > lecture), then all
                    if tut_key and tut_key in labs_by_key:
                        candidate_labs = labs_by_key[tut_key]
                    elif lec_key and lec_key in labs_by_key:
                        candidate_labs = labs_by_key[lec_key]
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
