# api/wcq_subjects.py
import re
from typing import List
import httpx
from bs4 import BeautifulSoup

WCQ_BASE = "https://w5.ab.ust.hk/wcq/cgi-bin"

def list_subjects(term: str) -> List[str]:
    url = f"{WCQ_BASE}/{term}/subject"
    r = httpx.get(url, timeout=30)
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
