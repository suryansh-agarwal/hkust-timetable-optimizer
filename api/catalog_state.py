# api/catalog_state.py
import json, os, time, tempfile
from typing import Dict, List, Any
from config import DATA_DIR

def state_path(term: str) -> str:
    return os.path.join(DATA_DIR, f"catalog_state_{term}.json")

def load_state(term: str, total_subjects: int) -> Dict[str, Any]:
    p = state_path(term)
    if not os.path.exists(p):
        return {
            "term": term,
            "total_subjects": total_subjects,
            "indexed_subjects": [],
            "failed_subjects": {},
            "updated_at": None,
        }
    with open(p, "r") as f:
        return json.load(f)

def save_state(term: str, state: Dict[str, Any]) -> None:
    state["updated_at"] = time.time()
    p = state_path(term)
    # atomic write
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix="tmp_", text=True)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(state, f)
        os.replace(tmp, p)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
