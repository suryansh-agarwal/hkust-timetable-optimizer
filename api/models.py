from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional, List


class Quota(BaseModel):
    quota: Optional[int] = None
    enrol: Optional[int] = None
    avail: Optional[int] = None
    wait: Optional[int] = None


class Meeting(BaseModel):
    day: str  # Mo Tu We Th Fr Sa Su
    start: str  # e.g. 10:30AM
    end: str    # e.g. 11:50AM

    # normalized fields (added by our normalizer)
    day_index: int
    start_min: int
    end_min: int


class Section(BaseModel):
    section: str
    class_no: int
    meetings: List[Meeting] = Field(default_factory=list)
    room: Optional[str] = None
    instructor: Optional[str] = None
    quota: Optional[Quota] = None
    remarks: List[str] = Field(default_factory=list)


class Course(BaseModel):
    course_code: str
    title: str
    units: int
    sections: List[Section] = Field(default_factory=list)
    # Matching constraint metadata (from mini-catalog or parsed HTML)
    matching_required: bool = False
    matching_type: Optional[str] = None  # "lab" | "tutorial" | "both" | None
    header_remarks: Optional[List[str]] = None


class SubjectPayload(BaseModel):
    term: str
    subject: str
    courses: List[Course] = Field(default_factory=list)
