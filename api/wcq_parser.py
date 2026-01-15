from __future__ import annotations

import re
from typing import Any

from bs4 import BeautifulSoup

# -------- Course header detection --------
COURSE_HEADER_RE = re.compile(
    r"^([A-Z]{3,5})\s*(\d{4}[A-Z]?)\s*-\s*(.*?)\s*\((\d+)\s*units?\)\s*$"
)

def parse_subject_html(html: str, term: str, subject: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "lxml")

    # Find tables that look like the section/quota table (has these headers)
    candidate_tables = []
    for table in soup.find_all("table"):
        header_text = " ".join(table.get_text(" ", strip=True).split())
        if (
            "Section" in header_text
            and ("Date" in header_text or "Time" in header_text)
            and "Quota" in header_text
            and "Enrol" in header_text
            and "Avail" in header_text
        ):
            candidate_tables.append(table)

    courses: list[dict[str, Any]] = []
    course_map: dict[str, dict[str, Any]] = {}

    for table in candidate_tables:
        # Find nearest previous text node that matches a course header
        prev_text_node = table.find_previous(string=COURSE_HEADER_RE)
        if not prev_text_node:
            continue

        header = " ".join(str(prev_text_node).split())
        m = COURSE_HEADER_RE.match(header)
        if not m:
            continue

        subj, number, title, units_s = m.group(1), m.group(2), m.group(3), m.group(4)
        course_code = f"{subj} {number}"
        units = int(units_s)

        if course_code not in course_map:
            course_map[course_code] = {
                "course_code": course_code,
                "title": title,
                "units": units,
                "sections": [],
            }
            courses.append(course_map[course_code])

        sections = parse_sections_table(table)
        course_map[course_code]["sections"].extend(sections)

    return {"term": term, "subject": subject, "courses": courses}

# -------- Section table parsing (header-based) --------
SECTION_CELL_RE = re.compile(r"^([A-Z]{1,3}\d+[A-Z]?)\s*\((\d+)\)\s*$")
TIME_RANGE_RE = re.compile(r"(\d{1,2}:\d{2}[AP]M)\s*-\s*(\d{1,2}:\d{2}[AP]M)")
DAY_TOKEN_RE = re.compile(r"(Mo|Tu|We|Th|Fr|Sa|Su)")

def split_days(day_str: str) -> list[str]:
    return DAY_TOKEN_RE.findall(day_str)

def _norm_header(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())

HEADER_ALIASES = {
    "section": "section",
    "dateandtime": "date_time",
    "datetime": "date_time",
    "date": "date_time",
    "time": "date_time",
    "room": "room",
    "venue": "room",
    "instructor": "instructor",
    "quota": "quota",
    "enrol": "enrol",
    "enrollment": "enrol",
    "avail": "avail",
    "available": "avail",
    "wait": "wait",
    "waitlist": "wait",
    "remarks": "remarks",
    "remark": "remarks",
}

def _to_int(x: str) -> int | None:
    x = x.strip()
    if not x or x in {"-", "N/A"}:
        return None
    try:
        return int(x)
    except ValueError:
        return None

def _clean_lines(text: str) -> list[str]:
    lines = [ln.strip() for ln in text.replace("\xa0", " ").splitlines()]
    lines = [ln for ln in lines if ln]
    lines = [ln[1:].strip() if ln.startswith(">") else ln for ln in lines]
    return lines

def _parse_meetings(date_time_cell_text: str) -> list[dict[str, str]]:
    meetings: list[dict[str, str]] = []
    for line in _clean_lines(date_time_cell_text):
        tm = TIME_RANGE_RE.search(line)
        if not tm:
            continue
        start, end = tm.group(1), tm.group(2)
        left = line[: tm.start()].strip()
        days = split_days(left)
        for d in days:
            meetings.append({"day": d, "start": start, "end": end})
    return meetings

def parse_sections_table(table) -> list[dict[str, Any]]:
    rows = table.find_all("tr")
    header_map: dict[str, int] | None = None
    sections: list[dict[str, Any]] = []

    last_section_obj: dict[str, Any] | None = None

    for tr in rows:
        cell_elems = tr.find_all(["th", "td"])
        if not cell_elems:
            continue

        cell_texts = [c.get_text("\n", strip=True) for c in cell_elems]
        cell_texts = [t.replace("\xa0", " ").strip() for t in cell_texts]

        # Header row
        if header_map is None:
            normalized = [_norm_header(t) for t in cell_texts]
            if "section" in normalized and ("dateandtime" in normalized or "datetime" in normalized or "date" in normalized):
                header_map = {}
                for i, h in enumerate(normalized):
                    if h in HEADER_ALIASES:
                        header_map[HEADER_ALIASES[h]] = i
                continue
            else:
                continue

        def col(name: str) -> str:
            idx = header_map.get(name)
            if idx is None or idx >= len(cell_texts):
                return ""
            return cell_texts[idx]

        sec_cell = col("section").strip()
        date_time_text = col("date_time")
        room_text = col("room")
        instructor_text = col("instructor")
        remarks_text = col("remarks")

        m = SECTION_CELL_RE.match(sec_cell)

        # ---- Continuation row: section column is blank, but time/room continues ----
        if not m:
            if last_section_obj is not None and (sec_cell == "" or sec_cell == "-"):
                extra_meetings = _parse_meetings(date_time_text)
                if extra_meetings:
                    last_section_obj["meetings"].extend(extra_meetings)

                # Sometimes remarks spill into continuation rows
                extra_remarks = _clean_lines(remarks_text)
                for r in extra_remarks:
                    if r not in last_section_obj["remarks"]:
                        last_section_obj["remarks"].append(r)

                # Room/instructor may appear again; keep first unless empty
                if (not last_section_obj.get("room")) and room_text:
                    last_section_obj["room"] = " ".join(_clean_lines(room_text))
                if (not last_section_obj.get("instructor")) and instructor_text:
                    last_section_obj["instructor"] = " ".join(_clean_lines(instructor_text))

            continue

        # ---- New section row ----
        sec_name = m.group(1)
        class_no = int(m.group(2))

        meetings = _parse_meetings(date_time_text)
        remarks_lines = _clean_lines(remarks_text)

        quota = _to_int(col("quota"))
        enrol = _to_int(col("enrol"))
        avail = _to_int(col("avail"))
        wait = _to_int(col("wait"))

        section_obj: dict[str, Any] = {
            "section": sec_name,
            "class_no": class_no,
            "meetings": meetings,
            "room": " ".join(_clean_lines(room_text)) if room_text else None,
            "instructor": " ".join(_clean_lines(instructor_text)) if instructor_text else None,
            "quota": None,
            "remarks": remarks_lines,
        }

        if quota is not None or enrol is not None or avail is not None or wait is not None:
            section_obj["quota"] = {"quota": quota, "enrol": enrol, "avail": avail, "wait": wait}

        sections.append(section_obj)
        last_section_obj = section_obj

    # Optional: dedupe meetings within a section
    for s in sections:
        seen = set()
        uniq = []
        for m in s["meetings"]:
            key = (m["day"], m["start"], m["end"])
            if key not in seen:
                seen.add(key)
                uniq.append(m)
        s["meetings"] = uniq

    return sections

