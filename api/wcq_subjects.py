# api/wcq_subjects.py
import json
import os
import re
import time
from typing import List, Optional

from wcq_client import fetch_html

WCQ_BASE = "https://w5.ab.ust.hk/wcq/cgi-bin"

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

# Legacy term-independent list, kept as a last-resort fallback.
STATIC_SUBJECTS_PATH = os.path.join(STATIC_DIR, "subjects.json")

# A term's landing page links to every subject it offers.
SUBJECT_LINK_RE = re.compile(r"/wcq/cgi-bin/(\d{4})/subject/([A-Z]{3,5})\b")

CACHE_MAX_AGE_SEC = 12 * 60 * 60


def _term_cache_path(term: str) -> str:
    return os.path.join(STATIC_DIR, f"subjects_{term}.json")


def _read_term_cache(term: str, max_age_sec: Optional[int]) -> List[str]:
    """Read the per-term cache. Pass max_age_sec=None to accept it at any age."""
    path = _term_cache_path(term)
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r") as f:
            data = json.load(f)
    except Exception:
        return []

    if not isinstance(data, dict) or not isinstance(data.get("subjects"), list):
        return []

    if max_age_sec is not None:
        try:
            if time.time() - float(data.get("fetched_at")) > max_age_sec:
                return []
        except (TypeError, ValueError):
            return []

    return [str(s).upper() for s in data["subjects"] if str(s).strip()]


def _write_term_cache(term: str, subjects: List[str]) -> None:
    try:
        os.makedirs(STATIC_DIR, exist_ok=True)
        payload = {"fetched_at": time.time(), "subjects": subjects}
        with open(_term_cache_path(term), "w") as f:
            json.dump(payload, f, indent=2)
    except Exception as e:
        # A read-only or ephemeral filesystem must not break the request.
        print(f"Warning: could not cache subjects for {term}: {e}")


def _load_static_subjects() -> List[str]:
    """Load the legacy term-independent subjects list."""
    if os.path.exists(STATIC_SUBJECTS_PATH):
        try:
            with open(STATIC_SUBJECTS_PATH, "r") as f:
                return json.load(f)
        except Exception:
            return []
    return []


def _fetch_subjects_from_wcq(term: str) -> List[str]:
    """Scrape the term landing page for the subjects it offers."""
    html = fetch_html(f"{WCQ_BASE}/{term}/", timeout=40.0)

    # Only take links belonging to this term - the page also links to other terms.
    subjects = {
        subject for link_term, subject in SUBJECT_LINK_RE.findall(html) if link_term == term
    }
    return sorted(subjects)


def list_subjects(term: str) -> List[str]:
    """
    Get the list of subject codes offered in a term.

    Prefers a fresh per-term cache, then a live scrape of WCQ, then a stale
    cache, then the legacy term-independent list.
    """
    cached = _read_term_cache(term, CACHE_MAX_AGE_SEC)
    if cached:
        return cached

    try:
        subjects = _fetch_subjects_from_wcq(term)
        if subjects:
            _write_term_cache(term, subjects)
            return subjects
    except Exception as e:
        print(f"Warning: failed to fetch subjects for {term} from WCQ: {e}")

    stale = _read_term_cache(term, None)
    if stale:
        return stale

    return _load_static_subjects()
