#!/usr/bin/env python3
"""
Build a static mini-catalog for a given term.

Usage:
    python scripts/build_course_index.py --term 2530 --api-base http://127.0.0.1:8000 --out web/public/course-index/2530.json

This script:
1. Fetches the list of subjects from the backend
2. For each subject, fetches FULL course data including matching requirements
3. Extracts: course_code, title, units, subject, matching_required, matching_type, header_remarks
4. Writes a compact JSON array to the output file

Retry strategy:
- Round 1: Try all subjects once
- Round 2-10: Retry all previously failed subjects
- Each round uses increasing delay between requests

The mini-catalog is used for:
- Fast client-side search (course_code, title)
- Matching constraint metadata (matching_required, matching_type)
"""

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import httpx

# The picker's names and the optimiser's filter must agree on what counts as
# an unnamed instructor, so both use api/instructor_filter.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from instructor_filter import collect_instructors  # noqa: E402


def fetch_subjects(api_base: str, term: str) -> list[str]:
    """Fetch list of subjects from /wcq/subjects endpoint."""
    url = f"{api_base}/wcq/subjects?term={term}"
    print(f"Fetching subjects from: {url}")
    r = httpx.get(url, timeout=30)
    r.raise_for_status()
    data = r.json()
    return data.get("subjects", [])


def fetch_subject_once(api_base: str, term: str, subject: str) -> dict[str, Any] | None:
    """
    Fetch full subject data (single attempt, no retry).
    Returns subject payload on success, None on failure.
    """
    url = f"{api_base}/wcq/subject?term={term}&subject={subject}"
    try:
        r = httpx.get(url, timeout=90)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        err_msg = str(e)
        if len(err_msg) > 80:
            err_msg = err_msg[:77] + "..."
        print(f"FAILED: {err_msg}")
        return None


def process_subject_data(
    data: dict[str, Any],
    subject: str,
    index: list[dict[str, Any]],
    seen_codes: set[str]
) -> int:
    """
    Process fetched subject data and add courses to index.
    Returns number of courses added.
    """
    courses = data.get("courses", [])
    added = 0
    
    for c in courses:
        code = c.get("course_code", "")
        if code and code not in seen_codes:
            seen_codes.add(code)
            
            # Extract matching metadata
            matching_required = c.get("matching_required", False)
            matching_type = c.get("matching_type")
            header_remarks = c.get("header_remarks")
            
            entry = {
                "course_code": code,
                "title": c.get("title", ""),
                "units": c.get("units"),
                "subject": subject,
            }

            # Names shown in the professor picker. Omitted when every section
            # is TBA, so the UI can hide the control entirely.
            instructors = collect_instructors(c.get("sections") or [])
            if instructors:
                entry["instructors"] = instructors

            # Only include matching fields if matching is required
            if matching_required:
                entry["matching_required"] = True
                if matching_type:
                    entry["matching_type"] = matching_type
            
            # Include header_remarks if present and short enough
            if header_remarks:
                # Keep only short remarks to avoid bloating the index
                short_remarks = [r for r in header_remarks if len(r) < 200][:3]
                if short_remarks:
                    entry["header_remarks"] = short_remarks
            
            index.append(entry)
            added += 1
    
    return added


def build_index(
    api_base: str, 
    term: str, 
    base_delay: float = 0.5,
    max_rounds: int = 10
) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    """
    Build the mini-catalog by fetching all subjects and their courses.
    
    Retry strategy:
    - Round 1: Try all subjects with base_delay between requests
    - Round 2+: Retry failed subjects with increasing delays (base_delay * round)
    - Stop when all succeed or max_rounds reached
    
    Returns (index_entries, failed_subjects, all_subjects).
    """
    subjects = fetch_subjects(api_base, term)
    print(f"Found {len(subjects)} subjects\n")

    index: list[dict[str, Any]] = []
    seen_codes: set[str] = set()
    
    # Track which subjects still need fetching
    pending_subjects = list(subjects)
    failed_subjects: list[str] = []
    
    for round_num in range(1, max_rounds + 1):
        if not pending_subjects:
            break
        
        # Calculate delay for this round (increases with each round)
        round_delay = base_delay * round_num
        
        if round_num == 1:
            print(f"Round {round_num}: Fetching {len(pending_subjects)} subjects (delay: {round_delay:.1f}s)")
        else:
            print(f"\nRound {round_num}: Retrying {len(pending_subjects)} failed subjects (delay: {round_delay:.1f}s)")
        print("-" * 50)
        
        round_failed: list[str] = []
        
        for i, subject in enumerate(pending_subjects, 1):
            print(f"  [{i:3d}/{len(pending_subjects)}] {subject:5s} ... ", end="", flush=True)
            
            data = fetch_subject_once(api_base, term, subject)
            
            if data is not None:
                added = process_subject_data(data, subject, index, seen_codes)
                print(f"OK ({added} courses)")
            else:
                round_failed.append(subject)
            
            # Delay between requests (except after last one)
            if round_delay > 0 and i < len(pending_subjects):
                time.sleep(round_delay)
        
        # Update pending for next round
        pending_subjects = round_failed
        failed_subjects = round_failed
        
        if round_failed:
            print(f"\nRound {round_num} complete: {len(round_failed)} subjects failed")
        else:
            print(f"\nRound {round_num} complete: All subjects succeeded!")
            break

    return index, failed_subjects, subjects


def main():
    parser = argparse.ArgumentParser(
        description="Build a static mini-catalog for a given term"
    )
    parser.add_argument(
        "--term",
        required=True,
        help="Term code (e.g. 2530)",
    )
    parser.add_argument(
        "--api-base",
        default="http://127.0.0.1:8000",
        help="Backend API base URL (default: http://127.0.0.1:8000)",
    )
    parser.add_argument(
        "--out",
        required=True,
        help="Output file path (e.g. web/public/course-index/2530.json)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.5,
        help="Base delay between subjects in seconds (default: 0.5). Multiplied by round number.",
    )
    parser.add_argument(
        "--max-rounds",
        type=int,
        default=10,
        help="Max retry rounds (default: 10). Each round retries all previously failed subjects.",
    )

    args = parser.parse_args()

    print(f"\n{'='*50}")
    print("  Building Mini-Catalog")
    print("="*50)
    print(f"  Term:        {args.term}")
    print(f"  API Base:    {args.api_base}")
    print(f"  Output:      {args.out}")
    print(f"  Base Delay:  {args.delay}s (multiplied by round #)")
    print(f"  Max Rounds:  {args.max_rounds}")
    print("="*50 + "\n")

    # Build the index
    index, failed, subjects = build_index(
        args.api_base, 
        args.term, 
        base_delay=args.delay,
        max_rounds=args.max_rounds
    )

    # Sort by course_code for stable output
    index.sort(key=lambda x: x["course_code"])

    # Ensure output directory exists
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Write compact JSON
    with open(out_path, "w") as f:
        json.dump(index, f, separators=(",", ":"))
    
    # Count stats
    matching_count = sum(1 for c in index if c.get("matching_required"))

    # Print summary
    print(f"\n{'='*50}")
    print("  Summary")
    print("="*50)
    print(f"  Subjects scanned:      {len(subjects)}")
    print(f"  Subjects succeeded:    {len(subjects) - len(failed)}")
    print(f"  Subjects failed:       {len(failed)}")
    print(f"  Courses indexed:       {len(index)}")
    print(f"  With matching req:     {matching_count}")
    print(f"  Output file:           {out_path}")
    print(f"  Output size:           {out_path.stat().st_size:,} bytes")
    
    if failed:
        print(f"\n  ⚠️  Failed subjects: {', '.join(failed)}")
        print("\n  The index is still usable but incomplete.")
        print("="*50)
        sys.exit(1)
    else:
        print("\n  ✅ All subjects fetched successfully!")
        print("="*50)


if __name__ == "__main__":
    main()
