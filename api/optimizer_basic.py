from __future__ import annotations

from dataclasses import dataclass
from typing import List, Dict, Any, Tuple

from models import SubjectPayload, Course, Section


def sections_conflict(a: Section, b: Section) -> bool:
    for m1 in a.meetings:
        for m2 in b.meetings:
            if m1.day_index != m2.day_index:
                continue
            # overlap if not (a ends before b starts OR b ends before a starts)
            if not (m1.end_min <= m2.start_min or m2.end_min <= m1.start_min):
                return True
    return False


def build_course_map(subject_payloads: List[SubjectPayload]) -> Dict[str, Course]:
    course_map: Dict[str, Course] = {}
    for sp in subject_payloads:
        for c in sp.courses:
            course_map[c.course_code] = c
    return course_map


@dataclass
class CourseChoice:
    course_code: str
    sections: List[Section]


def find_schedules(
    choices: List[CourseChoice],
    max_solutions: int = 1,
) -> List[Dict[str, Section]]:
    # Sort by fewest options first (massive speedup)
    choices = sorted(choices, key=lambda x: len(x.sections))

    solutions: List[Dict[str, Section]] = []
    chosen: Dict[str, Section] = {}

    def ok_to_add(candidate: Section) -> bool:
        for existing in chosen.values():
            if sections_conflict(candidate, existing):
                return False
        return True

    def backtrack(i: int) -> None:
        if len(solutions) >= max_solutions:
            return
        if i == len(choices):
            solutions.append(dict(chosen))
            return

        course = choices[i]
        for sec in course.sections:
            if ok_to_add(sec):
                chosen[course.course_code] = sec
                backtrack(i + 1)
                chosen.pop(course.course_code, None)

    backtrack(0)
    return solutions


def schedule_to_json(schedule: Dict[str, Section]) -> List[Dict[str, Any]]:
    out = []
    for course_code, sec in schedule.items():
        out.append(
            {
                "course_code": course_code,
                "section": sec.section,
                "class_no": sec.class_no,
                "meetings": [m.model_dump() for m in sec.meetings],
                "room": sec.room,
                "instructor": sec.instructor,
                "quota": sec.quota.model_dump() if sec.quota else None,
                "remarks": sec.remarks,
            }
        )
    # stable sort for nicer output
    out.sort(key=lambda x: x["course_code"])
    return out
