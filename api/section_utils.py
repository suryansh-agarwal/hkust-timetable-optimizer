import re

def section_type(section: str) -> str:
    s = section.strip().upper()

    # IMPORTANT: check LAB before LEC, because "LA1" starts with "L"
    if s.startswith(("LA", "LB", "LC", "LD")):
        return "LAB"
    if s.startswith("T"):
        return "TUT"
    if s.startswith("L"):
        return "LEC"
    return "OTH"


def group_key(section: str) -> str | None:
    """
    Extracts the leading digit group for pairing:
    L1 -> "1"
    T1A -> "1"
    LA1 -> "1"
    """
    m = re.search(r"(\d+)", section)
    return m.group(1) if m else None
