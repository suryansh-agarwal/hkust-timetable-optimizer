"""Why the optimiser returned nothing.

`blocked_by_lock` in main.py already handles the easy case: a lock that leaves
one course with no sections at all. These two functions handle what is left -
constraints that are individually satisfiable but impossible together, and
hard preferences that reject every schedule that does exist.

Both run only after the answer is already "nothing", so neither costs anything
on a successful optimise.
"""

from itertools import combinations
from typing import Any, Dict, List, Optional, Tuple

from optimizer_bundles import BundleChoice, bundle_conflicts

HARD_PREFIX = "hard_"


def mutually_exclusive_pairs(choices: List[BundleChoice]) -> List[Tuple[str, str]]:
    """Course pairs where every option of one clashes with every option of the other.

    Such a pair is a complete and minimal explanation: those two cannot both be
    scheduled whatever else is chosen. A pair with even one surviving
    combination is not the blocker and is deliberately not reported - naming it
    would send a student to change a course that was never the problem.

    Higher-order infeasibility - three courses that pair up fine but cannot all
    coexist - returns an empty list, and the caller says so honestly rather
    than inventing a culprit.
    """
    out: List[Tuple[str, str]] = []
    for a, b in combinations(choices, 2):
        # A course with no options at all is blocked_by_lock's business; it
        # fires earlier and names one course, which is the better message.
        if not a.bundles or not b.bundles:
            continue
        if all(bundle_conflicts(ba, bb) for ba in a.bundles for bb in b.bundles):
            out.append((a.course_code, b.course_code))
    return out


def blocking_hard_rules(breakdowns: List[Dict[str, Any]]) -> List[Dict[str, Optional[str]]]:
    """The hard rules that, between them, rejected every schedule.

    Union rather than intersection, and that is not a shortcut. score_schedule
    returns on the FIRST hard violation it finds (scoring.py:118, :131, :144),
    so each breakdown carries exactly one rule - not every rule that schedule
    breaks. Intersecting would report nothing whenever one schedule trips a
    free day and another trips a cutoff, even though those two rules are
    jointly responsible for there being no results.

    So the honest claim is "every schedule breaks at least one of these", which
    is what the caller's wording says.
    """
    seen: Dict[Tuple[str, Optional[str], Optional[str]], None] = {}
    for bd in breakdowns:
        for p in bd.get("penalties", []):
            kind = p.get("type", "")
            if not kind.startswith(HARD_PREFIX):
                continue
            seen[(kind, p.get("day"), p.get("cutoff"))] = None
    return [
        {"type": kind, "day": day, "cutoff": cutoff}
        for kind, day, cutoff in sorted(seen, key=lambda k: (k[0], k[1] or "", k[2] or ""))
    ]
