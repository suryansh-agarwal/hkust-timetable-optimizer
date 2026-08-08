"""Section pinning for per-component locks.

A student can pin one section per component type. This module owns the single
question "does this section survive the pins?", mirroring instructor_filter's
ownership of the professor rule.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from section_utils import section_type

# Only these three component types can be pinned. A section whose type is OTH
# has no corresponding key and is therefore never constrained.
COMPONENT_KEYS: Dict[str, str] = {"LEC": "lecture", "TUT": "tutorial", "LAB": "lab"}


def section_allows_pin(section_code: str, section_lock: Optional[Dict[str, Any]]) -> bool:
    """
    True when the section survives the pins.

    A pin constrains only its own component type: pinning a lecture must leave
    every tutorial and lab eligible, otherwise pinning one component would
    empty the others and make the course unschedulable.
    """
    if not section_lock:
        return True

    key = COMPONENT_KEYS.get(section_type(section_code))
    if key is None:
        return True

    pinned = section_lock.get(key)
    if not pinned:
        return True

    return section_code.strip().upper() == str(pinned).strip().upper()


def has_pin(section_lock: Optional[Dict[str, Any]]) -> bool:
    """True when at least one component is actually pinned.

    A dict whose values are all empty is not a pin. section_allows_pin already
    treats an empty value as unconstrained; callers deciding "is a pin active
    at all?" must use the same definition or the two will disagree.
    """
    if not section_lock:
        return False
    return any(bool(str(v).strip()) for v in section_lock.values() if v)
