"""Why the optimiser returned nothing.

Zero results has three causes needing different remedies: locks that clash
across courses, hard preferences that reject every schedule, and courses that
simply cannot coexist. The tests that matter most here are the negative ones -
naming a constraint that was not the blocker sends a student to change
something that was never the problem.
"""

from infeasibility import blocking_hard_rules, mutually_exclusive_pairs
from models import Meeting, Section
from optimizer_bundles import BundleChoice


def meeting(day_index, start_min, end_min):
    return Meeting(
        day=["Mo", "Tu", "We", "Th", "Fr"][day_index],
        start="09:00AM",
        end="10:20AM",
        day_index=day_index,
        start_min=start_min,
        end_min=end_min,
    )


def section(name, day_index, start_min, end_min):
    return Section(
        section=name,
        class_no=abs(hash(name)) % 9000,
        meetings=[meeting(day_index, start_min, end_min)],
    )


def choice(code, *bundles):
    return BundleChoice(course_code=code, bundles=list(bundles))


class TestMutuallyExclusivePairs:
    def test_names_a_pair_whose_every_option_clashes(self):
        # Each course has one surviving option, both Monday 09:00-10:20.
        a = choice("COMP 2011", [section("L2", 0, 540, 620)])
        b = choice("MATH 1014", [section("L1", 0, 540, 620)])
        assert mutually_exclusive_pairs([a, b]) == [("COMP 2011", "MATH 1014")]

    def test_stays_silent_when_one_combination_survives(self):
        # The case that matters: A's L1 clashes with B's L1, but A's L2 does
        # not. Reporting this pair would send the student to change a course
        # that is not the problem.
        a = choice("COMP 2011", [section("L1", 0, 540, 620)], [section("L2", 1, 540, 620)])
        b = choice("MATH 1014", [section("L1", 0, 540, 620)])
        assert mutually_exclusive_pairs([a, b]) == []

    def test_stays_silent_when_nothing_clashes(self):
        a = choice("COMP 2011", [section("L1", 0, 540, 620)])
        b = choice("MATH 1014", [section("L1", 1, 540, 620)])
        assert mutually_exclusive_pairs([a, b]) == []

    def test_ignores_a_course_with_no_options_at_all(self):
        # An empty course is blocked_by_lock's business - it fires earlier and
        # names one course, which is a better message than naming a pair.
        a = choice("COMP 2011")
        b = choice("MATH 1014", [section("L1", 0, 540, 620)])
        assert mutually_exclusive_pairs([a, b]) == []

    def test_finds_every_exclusive_pair_not_just_the_first(self):
        a = choice("A 1000", [section("L1", 0, 540, 620)])
        b = choice("B 1000", [section("L1", 0, 540, 620)])
        c = choice("C 1000", [section("L1", 0, 540, 620)])
        assert mutually_exclusive_pairs([a, b, c]) == [
            ("A 1000", "B 1000"),
            ("A 1000", "C 1000"),
            ("B 1000", "C 1000"),
        ]

    def test_a_multi_part_bundle_clashes_if_any_part_does(self):
        # A bundle is a lecture plus its tutorial; one clashing part is enough.
        a = choice("COMP 2011", [section("L1", 0, 540, 620), section("T1", 2, 600, 680)])
        b = choice("MATH 1014", [section("L1", 2, 640, 700)])
        assert mutually_exclusive_pairs([a, b]) == [("COMP 2011", "MATH 1014")]


class TestBlockingHardRules:
    def rejected(self, **kw):
        return {"rejected": True, "penalties": [dict(**kw)], "bonuses": []}

    def test_names_the_rule_every_schedule_broke(self):
        bds = [
            self.rejected(type="hard_no_after_violation", day="Fr", cutoff="15:00"),
            self.rejected(type="hard_no_after_violation", day="Fr", cutoff="15:00"),
        ]
        assert blocking_hard_rules(bds) == [
            {"type": "hard_no_after_violation", "day": "Fr", "cutoff": "15:00"}
        ]

    def test_unions_rather_than_intersects(self):
        # score_schedule returns on the FIRST hard violation, so one schedule
        # tripping a free day and another tripping a cutoff means each
        # breakdown holds a different single rule. Intersecting would report
        # nothing while both rules are jointly responsible.
        bds = [
            self.rejected(type="hard_free_day_violation", day="Tu"),
            self.rejected(type="hard_no_after_violation", day="Fr", cutoff="15:00"),
        ]
        assert blocking_hard_rules(bds) == [
            {"type": "hard_free_day_violation", "day": "Tu", "cutoff": None},
            {"type": "hard_no_after_violation", "day": "Fr", "cutoff": "15:00"},
        ]

    def test_deduplicates_the_same_rule_seen_many_times(self):
        bds = [self.rejected(type="hard_free_day_violation", day="Tu")] * 5
        assert blocking_hard_rules(bds) == [
            {"type": "hard_free_day_violation", "day": "Tu", "cutoff": None}
        ]

    def test_ignores_soft_penalties(self):
        bds = [{
            "rejected": True,
            "penalties": [
                {"type": "gaps_minutes", "minutes": 120},
                {"type": "soft_free_day", "day": "We"},
                {"type": "hard_free_day_violation", "day": "Tu"},
            ],
            "bonuses": [],
        }]
        assert blocking_hard_rules(bds) == [
            {"type": "hard_free_day_violation", "day": "Tu", "cutoff": None}
        ]

    def test_returns_nothing_for_an_empty_pool(self):
        assert blocking_hard_rules([]) == []
