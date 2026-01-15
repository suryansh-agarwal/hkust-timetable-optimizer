const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

if (!API_BASE) {
  throw new Error("NEXT_PUBLIC_API_BASE is not set. Configure it in Vercel env vars.");
}


export type Prefs = {
  hard_free_days?: string[];
  hard_no_after?: Record<string, string>;
  soft_free_days?: string[];
  soft_no_after?: Record<string, string>;
  soft_no_before?: Record<string, string>;
  prefer_one_free_day?: boolean;
  compact_days?: boolean;
  weights?: {
    gaps_per_min?: number;
    late_after_per_min?: number;
    early_before_per_min?: number;
  };
};

export async function fetchCourses(term: string, subject: string) {
  const url = `${API_BASE}/wcq/courses?term=${encodeURIComponent(term)}&subject=${encodeURIComponent(subject)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchCourses failed: ${res.status}`);
  return res.json();
}

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
  const res = await fetch(`${API_BASE}/catalog/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term, force, max_subjects }),
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
