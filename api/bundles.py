from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict, Any

from models import Course, Section
from section_utils import section_type, group_key


@dataclass
class Bundle:
    course_code: str
    parts: List[Section]  # e.g., [Lec, Tut, Lab]


def build_bundles(course: Course) -> List[Bundle]:
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

    # Determine required components
    need_tut = len(tuts) > 0
    need_lab = len(labs) > 0

    # If lecs are missing but there are tuts/labs, treat all as standalone (rare)
    if not lecs:
        return [Bundle(course.course_code, [s]) for s in course.sections]

    bundles: List[Bundle] = []

    # Pair by group_key when possible
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
        lk = group_key(lec.section)
        lec_tuts = tuts_by_key.get(lk, tuts) if need_tut else [None]
        for tut in lec_tuts:
            tut_labs = []
            if need_lab:
                # Prefer matching lab key to tutorial key if it exists; else lecture key; else all labs
                tk = group_key(tut.section) if tut else None
                if tk and tk in labs_by_key:
                    tut_labs = labs_by_key[tk]
                elif lk and lk in labs_by_key:
                    tut_labs = labs_by_key[lk]
                else:
                    tut_labs = labs
            else:
                tut_labs = [None]

            for lab in tut_labs:
                parts = [lec]
                if tut:
                    parts.append(tut)
                if lab:
                    parts.append(lab)
                bundles.append(Bundle(course.course_code, parts))

    # Deduplicate bundles by class_no set (avoid duplicates if pairing was broad)
    seen = set()
    unique: List[Bundle] = []
    for b in bundles:
        key = tuple(sorted(p.class_no for p in b.parts))
        if key not in seen:
            seen.add(key)
            unique.append(b)
    return unique
