from section_lock import COMPONENT_KEYS, has_pin, section_allows_pin


def test_no_lock_allows_everything():
    for code in ("L1", "T1A", "LA2", "R1"):
        assert section_allows_pin(code, None) is True
        assert section_allows_pin(code, {}) is True


def test_pin_keeps_only_the_named_lecture():
    lock = {"lecture": "L1"}
    assert section_allows_pin("L1", lock) is True
    assert section_allows_pin("L2", lock) is False


def test_pin_on_one_component_does_not_constrain_another():
    # A lecture pin must leave tutorials and labs alone.
    lock = {"lecture": "L1"}
    assert section_allows_pin("T1A", lock) is True
    assert section_allows_pin("LA3", lock) is True


def test_tutorial_and_lab_pins_are_independent():
    lock = {"tutorial": "T1B", "lab": "LA2"}
    assert section_allows_pin("T1B", lock) is True
    assert section_allows_pin("T1A", lock) is False
    assert section_allows_pin("LA2", lock) is True
    assert section_allows_pin("LA1", lock) is False
    # No lecture pin, so every lecture stays eligible.
    assert section_allows_pin("L9", lock) is True


def test_comparison_ignores_case_and_surrounding_space():
    assert section_allows_pin("L1", {"lecture": " l1 "}) is True


def test_unrecognised_section_types_are_never_constrained():
    # "R1" is OTH; no pin key maps to it.
    assert section_allows_pin("R1", {"lecture": "L1", "tutorial": "T1A"}) is True


def test_empty_pin_value_is_treated_as_no_pin():
    assert section_allows_pin("L2", {"lecture": ""}) is True
    assert section_allows_pin("L2", {"lecture": None}) is True


def test_component_keys_cover_the_three_real_types():
    assert COMPONENT_KEYS == {"LEC": "lecture", "TUT": "tutorial", "LAB": "lab"}


def test_has_pin_is_false_for_no_or_empty_locks():
    assert has_pin(None) is False
    assert has_pin({}) is False
    assert has_pin({"lecture": ""}) is False
    assert has_pin({"lecture": None}) is False


def test_has_pin_is_true_when_a_real_value_is_present():
    assert has_pin({"lecture": "L1"}) is True
    assert has_pin({"lecture": "", "tutorial": "T1A"}) is True
