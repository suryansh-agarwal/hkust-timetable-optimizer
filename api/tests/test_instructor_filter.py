from instructor_filter import (
    collect_instructors,
    is_unnamed,
    lock_is_satisfiable,
    normalise,
    section_allows,
)


def test_normalise_collapses_whitespace_and_uppercases():
    assert normalise("  li,   xin ") == "LI, XIN"
    assert normalise(None) == ""


def test_unnamed_values():
    for value in (None, "", "   ", "TBA", "tba", " Tba "):
        assert is_unnamed(value) is True
    assert is_unnamed("LI, Xin") is False


def test_unnamed_sections_are_always_allowed():
    # 92% of labs in 2610 are TBA; a lock must not delete them.
    for value in (None, "", "TBA", "tba"):
        assert section_allows(value, "LI, Xin") is True


def test_name_matches_ignoring_case_and_whitespace():
    assert section_allows("LI, Xin", "li,  xin") is True


def test_multi_instructor_cell_matches_either_name():
    # MATH 4992 L1 is literally this string - two people, no delimiter.
    cell = "KU, Yin Bon LEUNG, Shing Yu"
    assert section_allows(cell, "KU, Yin Bon") is True
    assert section_allows(cell, "LEUNG, Shing Yu") is True
    assert section_allows(cell, cell) is True


def test_different_professor_is_rejected():
    assert section_allows("CHAN, Cecia Ki", "LI, Xin") is False


def test_absent_lock_allows_every_section():
    assert section_allows("CHAN, Cecia Ki", None) is True
    assert section_allows("CHAN, Cecia Ki", "") is True


def test_lock_is_satisfiable_requires_a_named_match():
    # Only TBA sections surviving does not satisfy the lock.
    assert lock_is_satisfiable(["TBA", None], "LI, Xin") is False
    assert lock_is_satisfiable(["TBA", "LI, Xin"], "LI, Xin") is True


def test_absent_lock_is_always_satisfiable():
    assert lock_is_satisfiable(["TBA"], None) is True


def test_collect_instructors_dedupes_preserving_order():
    sections = [
        {"section": "L1", "instructor": "TSOI, Yau Chat"},
        {"section": "L2", "instructor": "TSOI, Yau Chat"},
        {"section": "L3", "instructor": "LAM, Ngok"},
        {"section": "LA1", "instructor": "TBA"},
        {"section": "LA2", "instructor": None},
    ]
    assert collect_instructors(sections) == ["TSOI, Yau Chat", "LAM, Ngok"]


def test_collect_instructors_returns_empty_when_all_unnamed():
    assert collect_instructors([{"section": "LA1", "instructor": "TBA"}]) == []
