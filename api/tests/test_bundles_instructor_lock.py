from bundles import MatchingConstraint, build_bundles
from models import Course, Section


def make_course(sections):
    return Course(
        course_code="COMP 2011",
        title="Programming with C++",
        units=4,
        sections=[
            Section(section=name, class_no=idx + 1, instructor=instructor)
            for idx, (name, instructor) in enumerate(sections)
        ],
    )


def sections_in(bundles):
    return {part.section for bundle in bundles for part in bundle.parts}


def test_no_lock_keeps_every_lecture():
    course = make_course([
        ("L1", "LI, Xin"),
        ("L2", "CHAN, Cecia Ki"),
        ("LA1", "TBA"),
    ])
    assert sections_in(build_bundles(course)) == {"L1", "L2", "LA1"}


def test_lock_filters_lectures_but_keeps_tba_labs():
    course = make_course([
        ("L1", "LI, Xin"),
        ("L2", "CHAN, Cecia Ki"),
        ("LA1", "TBA"),
        ("LA2", "TBA"),
    ])
    bundles = build_bundles(course, MatchingConstraint(), instructor_lock="LI, Xin")
    found = sections_in(bundles)
    assert "L1" in found
    assert "L2" not in found
    # Labs are unassigned; dropping them would make the course unschedulable.
    assert {"LA1", "LA2"} <= found


def test_lock_keeps_matching_tutorial_and_drops_the_other():
    course = make_course([
        ("L1", "LI, Xuan"),
        ("L3", "KELLER, Wolfgang"),
        ("T1", "LI, Xuan"),
        ("T3", "KELLER, Wolfgang"),
    ])
    bundles = build_bundles(course, MatchingConstraint(), instructor_lock="KELLER, Wolfgang")
    found = sections_in(bundles)
    assert found == {"L3", "T3"}


def test_lock_naming_nobody_yields_no_bundles():
    course = make_course([
        ("L1", "LI, Xin"),
        ("LA1", "TBA"),
    ])
    assert build_bundles(course, MatchingConstraint(), instructor_lock="NOBODY, Real") == []


def test_lock_matching_only_tba_sections_yields_no_bundles():
    # Guards the "no lectures left" early return: TBA labs alone must not
    # become a valid schedule for the course.
    course = make_course([
        ("L1", "CHAN, Cecia Ki"),
        ("LA1", "TBA"),
        ("LA2", "TBA"),
    ])
    assert build_bundles(course, MatchingConstraint(), instructor_lock="LI, Xin") == []
