from __future__ import annotations

import json
import time
from typing import Any, Optional

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel

from catalog_store import (
    STATIC_DIR,
    build_course_index,
    catalog_counts,
    is_fresh,
    read_catalog,
    read_index,
    write_catalog,
    write_index,
)
from wcq_service import load_subject_payload


router = APIRouter(prefix="/catalog", tags=["catalog"])

FRESH_MAX_AGE_SEC = 12 * 60 * 60


class BuildCatalogRequest(BaseModel):
    term: str
    max_subjects: Optional[int] = None
    force: bool = False


class RefreshQuotasRequest(BaseModel):
    term: str
    subjects: Optional[list[str]] = None
    course_codes: Optional[list[str]] = None


def get_all_subjects(term: str) -> list[str]:
    subjects_path = STATIC_DIR / "subjects.json"
    if subjects_path.exists():
        try:
            data = json.loads(subjects_path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return [str(s).upper() for s in data if str(s).strip()]
        except Exception:
            pass
    return []


def _fetch_subject_payload(term: str, subject: str, refresh: bool = False) -> dict[str, Any]:
    last_err: Optional[Exception] = None
    for attempt in range(2):
        try:
            payload = load_subject_payload(term, subject, refresh=refresh)
            return payload.model_dump()
        except Exception as exc:  # noqa: BLE001 - we want to keep build going
            last_err = exc
            if attempt == 0:
                time.sleep(1)
                continue
            raise
    if last_err is not None:
        raise last_err
    raise RuntimeError("Unknown error while fetching subject payload.")


def _normalize_subjects(subjects: Optional[list[str]]) -> list[str]:
    if not subjects:
        return []
    return [s.strip().upper() for s in subjects if s and s.strip()]


def _normalize_course_codes(course_codes: Optional[list[str]]) -> list[str]:
    if not course_codes:
        return []
    return [c.strip().upper() for c in course_codes if c and c.strip()]


def _update_course_quotas(catalog_course: dict[str, Any], fresh_course: dict[str, Any]) -> int:
    updated_sections = 0
    catalog_sections = catalog_course.get("sections") or []
    by_class_no = {
        s.get("class_no"): s for s in catalog_sections if s.get("class_no") is not None
    }
    by_section = {s.get("section"): s for s in catalog_sections if s.get("section")}

    for fresh_section in fresh_course.get("sections") or []:
        target = None
        class_no = fresh_section.get("class_no")
        if class_no is not None and class_no in by_class_no:
            target = by_class_no[class_no]
        else:
            section_name = fresh_section.get("section")
            if section_name in by_section:
                target = by_section[section_name]

        if target is None:
            continue

        quota = fresh_section.get("quota")
        if quota is None:
            target["quota"] = None
        else:
            target["quota"] = {
                "quota": quota.get("quota"),
                "enrol": quota.get("enrol"),
                "avail": quota.get("avail"),
                "wait": quota.get("wait"),
            }
        updated_sections += 1

    return updated_sections


@router.post("/build")
def build_catalog(req: BuildCatalogRequest = Body(...)):
    term = req.term.strip()
    start_ts = time.time()

    existing = read_catalog(term)
    if not req.force and existing and is_fresh(existing.get("built_at"), FRESH_MAX_AGE_SEC):
        subjects_count, courses_count = catalog_counts(existing)
        return {
            "term": term,
            "subjects_built": subjects_count,
            "courses_built": courses_count,
            "built_at": existing.get("built_at"),
            "duration_sec": 0,
            "failed_subjects": [],
        }

    subjects = get_all_subjects(term)
    if req.max_subjects:
        subjects = subjects[: req.max_subjects]

    catalog: dict[str, Any] = {"term": term, "built_at": None, "subjects": {}}
    failed_subjects: list[dict[str, str]] = []

    for subject in subjects:
        try:
            payload = _fetch_subject_payload(term, subject, refresh=False)
            catalog["subjects"][subject.upper()] = payload
        except Exception as exc:  # noqa: BLE001
            failed_subjects.append({"subject": subject.upper(), "error": str(exc)})

    built_at = time.time()
    catalog["built_at"] = built_at

    write_catalog(term, catalog)
    write_index(term, build_course_index(catalog))

    subjects_count, courses_count = catalog_counts(catalog)
    duration_sec = int(time.time() - start_ts)

    return {
        "term": term,
        "subjects_built": subjects_count,
        "courses_built": courses_count,
        "built_at": built_at,
        "duration_sec": duration_sec,
        "failed_subjects": failed_subjects,
    }


@router.get("/status")
def catalog_status(term: str = Query(...)):
    data = read_catalog(term)
    path = f"api/data/catalog_{term}.json"
    if not data:
        return {
            "term": term,
            "exists": False,
            "built_at": None,
            "subjects": 0,
            "courses": 0,
            "age_sec": None,
            "path": path,
        }

    subjects_count, courses_count = catalog_counts(data)
    built_at = data.get("built_at")
    age_sec = int(time.time() - float(built_at)) if built_at else None

    return {
        "term": term,
        "exists": True,
        "built_at": built_at,
        "subjects": subjects_count,
        "courses": courses_count,
        "age_sec": age_sec,
        "path": path,
    }


@router.post("/refresh_quotas")
def refresh_quotas(req: RefreshQuotasRequest = Body(...)):
    term = req.term.strip()
    catalog = read_catalog(term)
    if not catalog:
        raise HTTPException(status_code=400, detail="Catalog missing. Build it first.")

    course_codes = _normalize_course_codes(req.course_codes)
    subjects = _normalize_subjects(req.subjects)

    if course_codes:
        target_subjects = set(subjects)
        for cc in course_codes:
            parts = cc.split()
            if parts:
                target_subjects.add(parts[0].upper())
    elif subjects:
        target_subjects = set(subjects)
    else:
        raise HTTPException(
            status_code=400, detail="Provide course_codes or subjects to refresh."
        )

    course_code_set = set(course_codes) if course_codes else None

    updated_courses = 0
    updated_sections = 0
    subjects_refetched: list[str] = []

    catalog_subjects = catalog.get("subjects") or {}

    for subject in sorted(target_subjects):
        fresh_payload = _fetch_subject_payload(term, subject, refresh=True)
        fresh_courses = fresh_payload.get("courses") or []
        cached_subject = catalog_subjects.get(subject)
        if not cached_subject:
            continue

        cached_courses = cached_subject.get("courses") or []
        cached_by_code = {c.get("course_code"): c for c in cached_courses}

        for fresh_course in fresh_courses:
            code = fresh_course.get("course_code")
            if not code:
                continue
            if course_code_set and code not in course_code_set:
                continue
            cached_course = cached_by_code.get(code)
            if not cached_course:
                continue
            changed_sections = _update_course_quotas(cached_course, fresh_course)
            if changed_sections:
                updated_sections += changed_sections
                updated_courses += 1

        subjects_refetched.append(subject)

    write_catalog(term, catalog)

    return {
        "ok": True,
        "term": term,
        "refreshed_at": time.time(),
        "updated_courses": updated_courses,
        "updated_sections": updated_sections,
        "subjects_refetched": subjects_refetched,
    }


def _ranked_match(q: str, course: dict[str, Any]) -> Optional[int]:
    q_norm = q.lower().replace(" ", "")
    code = (course.get("course_code") or "").lower()
    code_norm = code.replace(" ", "")
    title = (course.get("title") or "").lower()
    subject = (course.get("subject") or "").lower()

    if not q_norm:
        return None

    if code_norm.startswith(q_norm) or subject.startswith(q_norm):
        return 3
    if q_norm in code_norm:
        return 2
    if q_norm in title:
        return 1
    return None


@router.get("/search")
def catalog_search(
    term: str = Query(...),
    q: str = Query(...),
    limit: int = Query(20, ge=1, le=200),
):
    index = read_index(term)
    if index is None:
        catalog = read_catalog(term)
        if catalog:
            index = build_course_index(catalog)
        else:
            index = []

    matches: list[tuple[int, dict[str, Any]]] = []
    for course in index:
        score = _ranked_match(q, course)
        if score is not None:
            matches.append((score, course))

    matches.sort(key=lambda x: (-x[0], x[1].get("course_code") or ""))
    results = [c for _, c in matches[:limit]]

    return {"term": term, "q": q, "results": results}


@router.get("/course")
def catalog_course(term: str = Query(...), course_code: str = Query(...)):
    catalog = read_catalog(term)
    if not catalog:
        return {"term": term, "course": None, "found": False}

    normalized = course_code.strip().upper()
    for subject in (catalog.get("subjects") or {}).values():
        for course in subject.get("courses") or []:
            if (course.get("course_code") or "").upper() == normalized:
                return {"term": term, "course": course, "found": True}

    return {"term": term, "course": None, "found": False}


