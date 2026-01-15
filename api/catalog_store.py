from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Optional, Tuple


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
STATIC_DIR = BASE_DIR / "static"


def catalog_path(term: str) -> Path:
    return DATA_DIR / f"catalog_{term}.json"


def index_path(term: str) -> Path:
    return DATA_DIR / f"course_index_{term}.json"


def read_catalog(term: str) -> Optional[dict[str, Any]]:
    path = catalog_path(term)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def write_catalog(term: str, data: dict[str, Any]) -> None:
    path = catalog_path(term)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=True, indent=2), encoding="utf-8")


def read_index(term: str) -> Optional[list[dict[str, Any]]]:
    path = index_path(term)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def write_index(term: str, data: list[dict[str, Any]]) -> None:
    path = index_path(term)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=True, indent=2), encoding="utf-8")


def catalog_counts(data: dict[str, Any]) -> Tuple[int, int]:
    subjects = data.get("subjects") or {}
    subjects_count = len(subjects)
    courses_count = 0
    for subj in subjects.values():
        courses = subj.get("courses") or []
        courses_count += len(courses)
    return subjects_count, courses_count


def build_course_index(catalog: dict[str, Any]) -> list[dict[str, Any]]:
    subjects = catalog.get("subjects") or {}
    results: list[dict[str, Any]] = []
    for subject_code, payload in subjects.items():
        for course in payload.get("courses") or []:
            results.append(
                {
                    "course_code": course.get("course_code"),
                    "title": course.get("title"),
                    "units": course.get("units"),
                    "subject": subject_code,
                }
            )
    return results


def is_fresh(built_at: Optional[float], max_age_sec: int) -> bool:
    if built_at is None:
        return False
    try:
        return (time.time() - float(built_at)) <= max_age_sec
    except Exception:
        return False


def get_course_from_catalog(term: str, course_code: str) -> Optional[dict[str, Any]]:
    catalog = read_catalog(term)
    if not catalog:
        return None
    normalized = course_code.strip().upper()
    for subject in (catalog.get("subjects") or {}).values():
        for course in subject.get("courses") or []:
            if (course.get("course_code") or "").upper() == normalized:
                return course
    return None


