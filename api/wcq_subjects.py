# api/wcq_subjects.py
import json
import os
import re
from typing import List
import httpx
from bs4 import BeautifulSoup

WCQ_BASE = "https://w5.ab.ust.hk/wcq/cgi-bin"

# Path to static subjects list (fallback when network fails)
STATIC_SUBJECTS_PATH = os.path.join(os.path.dirname(__file__), "static", "subjects.json")


def _load_static_subjects() -> List[str]:
    """Load subjects from static JSON file."""
    if os.path.exists(STATIC_SUBJECTS_PATH):
        with open(STATIC_SUBJECTS_PATH, "r") as f:
            return json.load(f)
    return []


def _fetch_subjects_from_wcq(term: str) -> List[str]:
    """Fetch subjects list by scraping the WCQ website."""
    url = f"{WCQ_BASE}/{term}/subject"
    r = httpx.get(url, timeout=30, verify=False)  # disable SSL verification as fallback
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "html.parser")
    subjects = set()

    # links look like .../subject/FINA, .../subject/COMP, etc
    for a in soup.select('a[href*="/subject/"]'):
        href = a.get("href", "")
        m = re.search(r"/subject/([A-Z0-9]+)", href)
        if m:
            subjects.add(m.group(1))

    return sorted(subjects)


def list_subjects(term: str) -> List[str]:
    """
    Get list of subject codes for a term.
    
    Uses static subjects.json as primary source (fast, reliable).
    Falls back to network fetch if static file is missing.
    """
    # Primary: use static file (no network dependency)
    static_subjects = _load_static_subjects()
    if static_subjects:
        return static_subjects
    
    # Fallback: try to fetch from WCQ website
    try:
        return _fetch_subjects_from_wcq(term)
    except Exception as e:
        print(f"Warning: Failed to fetch subjects from WCQ: {e}")
        return []
