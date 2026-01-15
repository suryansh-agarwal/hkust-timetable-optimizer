from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from routes.catalog import router as catalog_router
from catalog_store import get_course_from_catalog


from wcq_parser import parse_subject_html

from models import SubjectPayload, Course
from time_utils import to_minutes, day_index
from wcq_service import wcq, load_subject_payload

from typing import Dict
from models import SubjectPayload
from optimizer_basic import CourseChoice, find_schedules, schedule_to_json

from pydantic import BaseModel, Field
from fastapi import Body

from bundles import build_bundles
from optimizer_bundles import BundleChoice, find_bundle_schedules, schedule_to_json as schedule_to_json_bundles

from typing import Any, Optional, Dict, List
from pydantic import BaseModel, Field, field_validator, model_validator
import re

from scoring import score_schedule
from optimizer_bundles import BundleChoice, find_bundle_schedules, schedule_to_json as schedule_to_json_bundles

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(catalog_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # your Next.js dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class OptimizeBasicRequest(BaseModel):
    term: str
    course_codes: list[str] = Field(default_factory=list)
    max_solutions: int = 1
    refresh: bool = False  # if true, force refresh all subjects
    use_cache: bool = True

VALID_DAYS = {"Mo", "Tu", "We", "Th", "Fr"}
TIME_24H_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def _validate_day(d: str) -> str:
    if d not in VALID_DAYS:
        raise ValueError(f"Invalid day '{d}'. Must be one of {VALID_DAYS}")
    return d


def _validate_time_24h(t: str) -> str:
    if not TIME_24H_RE.match(t):
        raise ValueError(f"Invalid time '{t}'. Must be HH:MM in 24-hour format")
    return t


def _load_courses_with_cache(
    term: str,
    course_codes: list[str],
    refresh: bool,
    use_cache: bool,
) -> tuple[dict[str, Course], list[str], list[str]]:
    course_map: dict[str, Course] = {}
    subjects_to_fetch: set[str] = set()
    cache_misses: list[str] = []

    if use_cache:
        for cc in course_codes:
            course = get_course_from_catalog(term, cc)
            if course:
                course_model = Course.model_validate(course)
                course_map[course_model.course_code] = course_model
            else:
                cache_misses.append(cc)
                parts = cc.strip().split()
                if parts:
                    subjects_to_fetch.add(parts[0].upper())
    else:
        for cc in course_codes:
            parts = cc.strip().split()
            if parts:
                subjects_to_fetch.add(parts[0].upper())

    if subjects_to_fetch:
        for subj in sorted(subjects_to_fetch):
            payload = load_subject_payload(term, subj, refresh=refresh)
            for c in payload.courses:
                course_map[c.course_code] = c

    return course_map, sorted(subjects_to_fetch), cache_misses


class Weights(BaseModel):
    gaps_per_min: float = 0.10
    late_after_per_min: float = 0.50
    early_before_per_min: float = 0.50


class Preferences(BaseModel):
    # Hard constraints
    hard_free_days: List[str] = Field(default_factory=list)  # e.g. ["Tu"]
    hard_no_after: Dict[str, str] = Field(default_factory=dict)  # e.g. {"Fr": "15:00"}

    # Soft preferences (penalties)
    soft_free_days: List[str] = Field(default_factory=list)
    soft_no_after: Dict[str, str] = Field(default_factory=dict)
    soft_no_before: Dict[str, str] = Field(default_factory=dict)  # e.g. {"Mo": "10:00"}

    # Style preferences (penalties)
    prefer_one_free_day: bool = False
    compact_days: bool = False  # fewer gaps within a day

    # Weights for scoring
    weights: Weights = Field(default_factory=Weights)

    @field_validator("hard_free_days", "soft_free_days", mode="after")
    @classmethod
    def validate_day_list(cls, v: List[str]) -> List[str]:
        return [_validate_day(d) for d in v]

    @model_validator(mode="after")
    def validate_day_time_dicts(self):
        for name in ("hard_no_after", "soft_no_after", "soft_no_before"):
            d = getattr(self, name)
            for day, time in d.items():
                _validate_day(day)
                _validate_time_24h(time)
        return self

class OptimizeRankedRequest(BaseModel):
    term: str
    course_codes: List[str]
    max_solutions: int = 10          # return top K
    search_limit: int = 5000         # how many feasible schedules to search/score internally
    refresh: bool = False
    use_cache: bool = True
    prefs: Preferences = Preferences()

@app.post("/optimize/ranked")
def optimize_ranked(req: OptimizeRankedRequest):
    if not req.course_codes:
        raise HTTPException(status_code=400, detail="course_codes cannot be empty")

    course_map, subjects_fetched, cache_misses = _load_courses_with_cache(
        req.term, req.course_codes, req.refresh, req.use_cache
    )

    missing = [cc for cc in req.course_codes if cc not in course_map]
    if missing:
        return {
            "ok": False,
            "error": "Course codes not found",
            "missing": missing,
            "subjects_fetched": subjects_fetched,
            "cache_misses": cache_misses,
        }

    choices = []
    for cc in req.course_codes:
        course = course_map[cc]
        bundles = build_bundles(course)
        choices.append(BundleChoice(course_code=cc, bundles=[b.parts for b in bundles]))

    # Find a pool of feasible schedules. We'll cap by search_limit by requesting more solutions.
    pool = find_bundle_schedules(choices, max_solutions=max(req.search_limit, req.max_solutions))

    # Deduplicate schedules by sorted class_nos
    seen = set()
    unique_pool = []
    for sch in pool:
        key = tuple(sorted(p.class_no for parts in sch.values() for p in parts))
        if key not in seen:
            seen.add(key)
            unique_pool.append(sch)

    scored = []
    for sch in unique_pool:
        s, why = score_schedule(sch, req.prefs)
        if s != float("-inf"):
            scored.append((s, why, sch))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[: req.max_solutions]

    return {
        "ok": True,
        "term": req.term,
        "subjects_fetched": subjects_fetched,
        "cache_misses": cache_misses,
        "returned": len(top),
        "considered": len(unique_pool),
        "results": [
            {
                "score": s,
                "breakdown": why,
                "schedule": schedule_to_json_bundles(sch),
            }
            for (s, why, sch) in top
        ],
    }

@app.get("/wcq/courses")
def list_courses(term: str, subject: str, refresh: bool = False):
    sp = load_subject_payload(term, subject.upper(), refresh=refresh)
    return {
        "term": term,
        "subject": subject.upper(),
        "courses": [{"course_code": c.course_code, "title": c.title, "units": c.units} for c in sp.courses],
    }


@app.post("/optimize/basic")
def optimize_basic(req: OptimizeBasicRequest = Body(...)):
    try:
        if not req.course_codes:
            raise ValueError("course_codes cannot be empty")

        course_map, subjects_fetched, cache_misses = _load_courses_with_cache(
            req.term, req.course_codes, req.refresh, req.use_cache
        )

        missing = [cc for cc in req.course_codes if cc not in course_map]
        if missing:
            return {
                "ok": False,
                "error": "Some course codes were not found in the fetched subjects.",
                "missing": missing,
                "subjects_fetched": subjects_fetched,
                "cache_misses": cache_misses,
            }

        choices = []
        for cc in req.course_codes:
            course = course_map[cc]
            if not course.sections:
                return {"ok": False, "error": f"No sections found for {cc}."}
            choices.append(CourseChoice(course_code=cc, sections=course.sections))

        solutions = find_schedules(choices, max_solutions=max(1, req.max_solutions))
        if not solutions:
            return {
                "ok": False,
                "error": "No clash-free schedule exists with 1 section per course (v1).",
                "note": "Some courses require lecture+tutorial+lab pairing; we’ll support that in the next milestone.",
            }

        return {
            "ok": True,
            "term": req.term,
            "solutions": [schedule_to_json(sol) for sol in solutions],
            "subjects_fetched": subjects_fetched,
            "cache_misses": cache_misses,
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/optimize/bundles")
def optimize_bundles(req: OptimizeBasicRequest):
    if not req.course_codes:
        raise HTTPException(status_code=400, detail="course_codes cannot be empty")

    course_map, subjects_fetched, cache_misses = _load_courses_with_cache(
        req.term, req.course_codes, req.refresh, req.use_cache
    )

    missing = [cc for cc in req.course_codes if cc not in course_map]
    if missing:
        return {
            "ok": False,
            "error": "Course codes not found",
            "missing": missing,
            "subjects_fetched": subjects_fetched,
            "cache_misses": cache_misses,
        }

    choices = []
    for cc in req.course_codes:
        course = course_map[cc]
        bundles = build_bundles(course)  # list[Bundle]
        if not bundles:
            return {"ok": False, "error": f"No bundle options found for {cc}"}
        choices.append(BundleChoice(course_code=cc, bundles=[b.parts for b in bundles]))

    solutions = find_bundle_schedules(choices, max_solutions=max(1, req.max_solutions))
    if not solutions:
        return {
            "ok": False,
            "error": "No clash-free schedule exists with LEC/TUT/LAB bundling.",
        }

    return {
        "ok": True,
        "term": req.term,
        "subjects_fetched": subjects_fetched,
        "cache_misses": cache_misses,
        "solutions": [schedule_to_json_bundles(sol) for sol in solutions],
    }


@app.get("/health")
def health():
    return {"ok": True}

@app.get("/wcq/raw")
def wcq_raw(term: str = Query(...), subject: str = Query(...), refresh: int = 0):
    try:
        result = wcq.fetch_subject_html(term, subject, force_refresh=bool(refresh))
        return {
            "term": term,
            "subject": subject.upper(),
            "cache_hit": result.cache_hit,
            "fetched_at": result.fetched_at,
            "url": result.url,
            "html": result.html,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/wcq/subject")
def wcq_subject(term: str = Query(...), subject: str = Query(...), refresh: int = 0):
    try:
        result = wcq.fetch_subject_html(term, subject, force_refresh=bool(refresh))
        parsed = parse_subject_html(result.html, term=term, subject=subject.upper())

        # normalize meetings
        for course in parsed.get("courses", []):
            for sec in course.get("sections", []):
                for mtg in sec.get("meetings", []):
                    mtg["day_index"] = day_index(mtg["day"])
                    mtg["start_min"] = to_minutes(mtg["start"])
                    mtg["end_min"] = to_minutes(mtg["end"])

        # validate schema
        validated = SubjectPayload.model_validate(parsed).model_dump()

        validated["_meta"] = {
            "cache_hit": result.cache_hit,
            "fetched_at": result.fetched_at,
            "url": result.url,
        }
        return validated
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

