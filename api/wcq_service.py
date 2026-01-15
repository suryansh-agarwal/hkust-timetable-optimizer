from __future__ import annotations

from typing import Any

from wcq_client import WcqClient
from wcq_parser import parse_subject_html
from models import SubjectPayload
from time_utils import to_minutes, day_index


wcq = WcqClient(cache_dir=".cache_wcq", ttl_seconds=20 * 60)


def load_subject_payload(term: str, subject: str, refresh: bool = False) -> SubjectPayload:
    result = wcq.fetch_subject_html(term, subject, force_refresh=refresh)
    parsed = parse_subject_html(result.html, term=term, subject=subject.upper())

    # normalize meetings (same logic as /wcq/subject)
    for course in parsed.get("courses", []):
        for sec in course.get("sections", []):
            for mtg in sec.get("meetings", []):
                mtg["day_index"] = day_index(mtg["day"])
                mtg["start_min"] = to_minutes(mtg["start"])
                mtg["end_min"] = to_minutes(mtg["end"])

    return SubjectPayload.model_validate(parsed)


def normalize_subject_payload(data: dict[str, Any]) -> dict[str, Any]:
    # Validate and return a JSON-friendly dict
    return SubjectPayload.model_validate(data).model_dump()


