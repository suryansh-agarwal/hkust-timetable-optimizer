const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

if (!API_BASE) {
  throw new Error("NEXT_PUBLIC_API_BASE is not set. Configure it in Vercel env vars.");
}

// ============================================================
// Static Course Index Types & Functions
// ============================================================

export type CourseIndexEntry = {
  course_code: string;
  title: string;
  units: number | null;
  subject: string;
  // Matching constraint metadata (optional, only present if matching_required=true)
  matching_required?: boolean;
  matching_type?: "lab" | "tutorial" | "both" | null;
  header_remarks?: string[];
};

// Module-level cache for loaded indexes (keyed by term)
const indexCache: Map<string, CourseIndexEntry[]> = new Map();

/**
 * Load the static course index for a term.
 * Returns cached data if already loaded.
 */
export async function loadCourseIndex(term: string): Promise<CourseIndexEntry[]> {
  // Return cached if available
  if (indexCache.has(term)) {
    return indexCache.get(term)!;
  }

  const url = `/course-index/${term}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load course index for term ${term}: ${res.status}`);
  }

  const data: CourseIndexEntry[] = await res.json();
  indexCache.set(term, data);
  return data;
}

/**
 * Clear the index cache (useful for testing or when switching terms).
 */
export function clearIndexCache(): void {
  indexCache.clear();
}

/**
 * Get the current cache status for a term.
 */
export function getIndexCacheStatus(term: string): { loaded: boolean; count: number } {
  const cached = indexCache.get(term);
  return {
    loaded: !!cached,
    count: cached?.length ?? 0,
  };
}

/**
 * Search the static course index.
 * Prioritizes:
 * 1. Exact prefix matches on course_code (e.g., "FINA" matches "FINA 1234")
 * 2. Substring matches on course_code
 * 3. Substring matches on title
 */
export function searchCourseIndex(
  term: string,
  query: string,
  limit: number = 30
): CourseIndexEntry[] {
  const cached = indexCache.get(term);
  if (!cached) {
    return [];
  }

  const q = query.trim().toUpperCase();
  if (!q) {
    return [];
  }

  const qLower = query.trim().toLowerCase();
  const qNoSpace = q.replaceAll(" ", "");

  // Score each entry:
  // - 3 points: course_code starts with query (prefix match)
  // - 2 points: course_code contains query (substring)
  // - 1 point: title contains query (substring, case-insensitive)
  type Scored = { entry: CourseIndexEntry; score: number };
  const scored: Scored[] = [];

  for (const entry of cached) {
    let score = 0;
    const codeUpper = entry.course_code.toUpperCase();
    const codeNoSpace = codeUpper.replaceAll(" ", "");
    const titleLower = entry.title.toLowerCase();

    if (codeUpper.startsWith(q) || codeNoSpace.startsWith(qNoSpace)) {
      score = 3;
    } else if (codeUpper.includes(q) || codeNoSpace.includes(qNoSpace)) {
      score = 2;
    } else if (titleLower.includes(qLower)) {
      score = 1;
    }

    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  // Sort by score (desc), then by course_code (asc) for stability
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.course_code.localeCompare(b.entry.course_code);
  });

  return scored.slice(0, limit).map((s) => s.entry);
}

// ============================================================
// Preferences Type
// ============================================================

export type Prefs = {
  hard_free_days?: string[];
  hard_no_after?: Record<string, string>;
  hard_no_before?: Record<string, string>;
  soft_free_days?: string[];
  soft_no_after?: Record<string, string>;
  soft_no_before?: Record<string, string>;
  prefer_one_free_day?: boolean;
  gap_shape?: "no_preference" | "consolidated" | "fragmented";
  weights?: {
    gaps_per_min?: number;
    late_after_per_min?: number;
    early_before_per_min?: number;
  };
};

// ============================================================
// Backend API Functions (still needed for course details & optimization)
// ============================================================

export async function fetchCourses(term: string, subject: string) {
  const url = `${API_BASE}/wcq/courses?term=${encodeURIComponent(term)}&subject=${encodeURIComponent(subject)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchCourses failed: ${res.status}`);
  return res.json();
}

export async function listSubjects(term: string) {
  const res = await fetch(`${API_BASE}/wcq/subjects?term=${encodeURIComponent(term)}`);
  if (!res.ok) throw new Error(`listSubjects failed: ${res.status}`);
  return res.json() as Promise<{ term: string; subjects: string[] }>;
}

export async function optimizeRanked(term: string, course_codes: string[], prefs: Prefs, max_solutions = 5) {
  const res = await fetch(`${API_BASE}/optimize/ranked`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      term,
      course_codes,
      max_solutions,
      search_limit: 2000,
      prefs,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`optimizeRanked failed: ${res.status} ${txt}`);
  }
  return res.json();
}

// ============================================================
// Legacy catalog functions (kept for compatibility, no longer used by UI)
// ============================================================

export async function catalogStatus(term: string) {
  const url = `${API_BASE}/catalog/status?term=${encodeURIComponent(term)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`catalogStatus failed: ${res.status}`);
  return res.json();
}

export async function catalogSearch(term: string, q: string, limit: number) {
  const url = `${API_BASE}/catalog/search?term=${encodeURIComponent(term)}&q=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`catalogSearch failed: ${res.status}`);
  return res.json();
}

export async function catalogBuild(term: string, force = false, max_subjects: number | null = null) {
  const payload: Record<string, unknown> = { term, force };
  if (max_subjects !== null) payload.max_subjects = max_subjects;

  const res = await fetch(`${API_BASE}/catalog/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`catalogBuild failed: ${res.status} ${txt}`);
  }
  return res.json();
}

export async function refreshQuotas(term: string, subjects?: string[], course_codes?: string[]) {
  const res = await fetch(`${API_BASE}/catalog/refresh_quotas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term, subjects, course_codes }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`refreshQuotas failed: ${res.status} ${txt}`);
  }
  return res.json();
}
