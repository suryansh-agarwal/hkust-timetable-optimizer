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


def test_lock_that_empties_the_tutorial_bucket_yields_no_bundles():
    # Tutorials are commonly run by TAs under their own names, so a lock on a
    # lecturer can empty the tutorial bucket. Deciding "is a tutorial
    # required?" from the filtered sections would read that as "no tutorial",
    # and hand back [[L1]] - a timetable missing a required class.
    course = make_course([
        ("L1", "KELLER, Wolfgang"),
        ("L2", "LI, Xuan"),
        ("T1", "CHAN, TA"),
        ("T2", "CHAN, TA"),
    ])
    assert build_bundles(course, MatchingConstraint(), instructor_lock="KELLER, Wolfgang") == []


def test_lock_that_empties_the_lab_bucket_yields_no_bundles():
    course = make_course([
        ("L1", "KELLER, Wolfgang"),
        ("L2", "LI, Xuan"),
        ("LA1", "CHAN, TA"),
        ("LA2", "CHAN, TA"),
    ])
    assert build_bundles(course, MatchingConstraint(), instructor_lock="KELLER, Wolfgang") == []


def test_lock_named_only_on_a_tutorial_yields_no_lectureless_bundles():
    # lock_is_satisfiable passes (a tutorial names the professor), every
    # lecture is filtered out, and the "no lectures" early return would emit
    # standalone tutorial bundles with no lecture at all.
    course = make_course([
        ("L1", "CHAN, Cecia Ki"),
        ("T1", "LI, Xin"),
        ("T2", "TBA"),
    ])
    assert build_bundles(course, MatchingConstraint(), instructor_lock="LI, Xin") == []


def test_course_without_tutorials_is_unaffected_by_the_component_guard():
    # No false positives: an absent component was never required.
    course = make_course([
        ("L1", "KELLER, Wolfgang"),
        ("L2", "LI, Xuan"),
        ("LA1", "TBA"),
    ])
    bundles = build_bundles(course, MatchingConstraint(), instructor_lock="KELLER, Wolfgang")
    assert sections_in(bundles) == {"L1", "LA1"}


def test_whitespace_only_lock_behaves_as_no_lock():
    course = make_course([
        ("L1", "LI, Xin"),
        ("L2", "CHAN, Cecia Ki"),
        ("LA1", "TBA"),
    ])
    assert sections_in(build_bundles(course, MatchingConstraint(), instructor_lock="   ")) == {
        "L1",
        "L2",
        "LA1",
    }


def test_lock_matching_only_tba_sections_yields_no_bundles():
    # Guards the "no lectures left" early return: TBA labs alone must not
    # become a valid schedule for the course.
    course = make_course([
        ("L1", "CHAN, Cecia Ki"),
        ("LA1", "TBA"),
        ("LA2", "TBA"),
    ])
    assert build_bundles(course, MatchingConstraint(), instructor_lock="LI, Xin") == []
