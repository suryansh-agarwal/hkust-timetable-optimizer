from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Any

from models import Section


@dataclass
class BundleChoice:
    course_code: str
    bundles: List[List[Section]]  # each bundle is list of sections


def bundle_conflicts(bundle: List[Section], chosen_sections: List[Section]) -> bool:
    # reuse conflict logic by flattening
    for s in bundle:
        for ex in chosen_sections:
            for m1 in s.meetings:
                for m2 in ex.meetings:
                    if m1.day_index != m2.day_index:
                        continue
                    if not (m1.end_min <= m2.start_min or m2.end_min <= m1.start_min):
                        return True
    return False


def find_bundle_schedules(choices: List[BundleChoice], max_solutions: int = 1) -> List[Dict[str, List[Section]]]:
    choices = sorted(choices, key=lambda x: len(x.bundles))
    solutions: List[Dict[str, List[Section]]] = []
    chosen: Dict[str, List[Section]] = {}

    def flat_chosen() -> List[Section]:
        out: List[Section] = []
        for parts in chosen.values():
            out.extend(parts)
        return out

    def backtrack(i: int):
        if len(solutions) >= max_solutions:
            return
        if i == len(choices):
            solutions.append({k: v[:] for k, v in chosen.items()})
            return

        course = choices[i]
        existing = flat_chosen()
        for bundle in course.bundles:
            if not bundle_conflicts(bundle, existing):
                chosen[course.course_code] = bundle
                backtrack(i + 1)
                chosen.pop(course.course_code, None)

    backtrack(0)
    return solutions


def schedule_to_json(schedule: Dict[str, List[Section]]) -> List[Dict[str, Any]]:
    out = []
    for course_code, parts in schedule.items():
        out.append({
            "course_code": course_code,
            "parts": [
                {
                    "section": s.section,
                    "class_no": s.class_no,
                    "meetings": [m.model_dump() for m in s.meetings],
                    "room": s.room,
                    "instructor": s.instructor,
                    "quota": s.quota.model_dump() if s.quota else None,
                    "remarks": s.remarks,
                }
                for s in parts
            ],
        })
    out.sort(key=lambda x: x["course_code"])
    return out
