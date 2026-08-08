from bundles import MatchingConstraint, build_bundles
from models import Course, Section


def make_course(sections):
    return Course(
        course_code="MATH 1003",
        title="Calculus and Linear Algebra",
        units=3,
        sections=[
            Section(section=name, class_no=idx + 1, instructor=instructor)
            for idx, (name, instructor) in enumerate(sections)
        ],
    )


def sections_in(bundles):
    return {part.section for bundle in bundles for part in bundle.parts}


LEC_TUT = [
    ("L1", "WU, Yueping"),
    ("L2", "WU, Yueping"),
    ("T1A", "WU, Yueping"),
    ("T1B", "WU, Yueping"),
    ("T2A", "WU, Yueping"),
]


def test_no_pins_is_unchanged():
    course = make_course(LEC_TUT)
    assert sections_in(build_bundles(course)) == {"L1", "L2", "T1A", "T1B", "T2A"}


def test_lecture_pin_keeps_only_that_lecture_and_leaves_tutorials_open():
    course = make_course(LEC_TUT)
    found = sections_in(build_bundles(course, MatchingConstraint(), section_lock={"lecture": "L1"}))
    assert "L1" in found
    assert "L2" not in found
    # No matching rule here, so every tutorial stays available.
    assert {"T1A", "T1B", "T2A"} <= found


def test_tutorial_pin_constrains_only_tutorials():
    course = make_course(LEC_TUT)
    found = sections_in(build_bundles(course, MatchingConstraint(), section_lock={"tutorial": "T1B"}))
    assert found == {"L1", "L2", "T1B"}


def test_pin_naming_a_missing_section_blocks_the_course():
    course = make_course(LEC_TUT)
    assert build_bundles(course, MatchingConstraint(), section_lock={"lecture": "L9"}) == []


def test_matched_course_admits_every_tutorial_in_the_pinned_group():
    course = make_course(LEC_TUT)
    matched = MatchingConstraint(matching_required=True, matching_type="tutorial")
    found = sections_in(build_bundles(course, matched, section_lock={"lecture": "L1"}))
    # L1's group is "1", so T1A and T1B are both valid; T2A is not.
    assert found == {"L1", "T1A", "T1B"}


def test_conflicting_lecture_and_tutorial_pins_block_the_course():
    course = make_course(LEC_TUT)
    matched = MatchingConstraint(matching_required=True, matching_type="tutorial")
    # T2A is in group 2, L1 is in group 1 - impossible together.
    assert build_bundles(course, matched, section_lock={"lecture": "L1", "tutorial": "T2A"}) == []


def test_empty_valued_section_lock_does_not_suppress_the_inconsistent_data_fallback():
    # L1/L2 have no matching tutorial group ("3"), so strict tutorial matching
    # finds nothing and the WCQ-inconsistent-data fallback should kick in --
    # the same as if section_lock were None -- because a dict of empty values
    # is not a real pin.
    course = make_course([
        ("L1", "WU, Yueping"),
        ("L2", "WU, Yueping"),
        ("T3A", "WU, Yueping"),
    ])
    matched = MatchingConstraint(matching_required=True, matching_type="tutorial")
    no_lock_result = build_bundles(course, matched, section_lock=None)
    empty_lock_result = build_bundles(
        course, matched, section_lock={"lecture": "", "tutorial": None}
    )
    assert empty_lock_result == no_lock_result


def test_section_pin_and_instructor_lock_compose():
    course = make_course([
        ("L1", "WU, Yueping"),
        ("L2", "WONG, Ka Yee"),
        ("T1A", "TBA"),
    ])
    found = sections_in(build_bundles(
        course, MatchingConstraint(),
        instructor_lock="WU, Yueping",
        section_lock={"lecture": "L1"},
    ))
    assert found == {"L1", "T1A"}
