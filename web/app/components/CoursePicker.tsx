"use client";

import { useEffect, useState, useMemo } from "react";
import { loadCourseIndex, searchCourseIndex, getIndexCacheStatus, CourseIndexEntry } from "@/lib/api";

function IndexStatusBadge({ loading, error, ready, count }: Readonly<{ loading: boolean; error: string; ready: boolean; count: number }>) {
  if (loading) {
    return <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading index...</span>;
  }
  if (error) {
    return <span style={{ fontSize: 12, color: "var(--danger)" }} title={error}>⚠️ Index error</span>;
  }
  if (ready) {
    return <span style={{ fontSize: 12, color: "var(--success)" }}>✓ Index: {count.toLocaleString()} courses</span>;
  }
  return <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Index not loaded</span>;
}

export function CoursePicker(props: Readonly<{
  term: string;
  selected: string[];
  setSelected: (codes: string[]) => void;
}>) {
  const { term, selected, setSelected } = props;

  const [q, setQ] = useState("");
  const [indexStatus, setIndexStatus] = useState<{ loaded: boolean; count: number; error: string }>({
    loaded: false,
    count: 0,
    error: "",
  });
  const [indexLoading, setIndexLoading] = useState(false);

  function add(courseCode: string) {
    if (selected.includes(courseCode)) return;
    setSelected([...selected, courseCode]);
  }

  function remove(courseCode: string) {
    setSelected(selected.filter((x) => x !== courseCode));
  }

  // Load index when term changes
  useEffect(() => {
    let cancelled = false;

    async function loadIndex() {
      setIndexLoading(true);
      setIndexStatus({ loaded: false, count: 0, error: "" });

      try {
        const data = await loadCourseIndex(term);
        if (cancelled) return;
        setIndexStatus({ loaded: true, count: data.length, error: "" });
      } catch (e: unknown) {
        if (cancelled) return;
        const errorMsg = e instanceof Error ? e.message : String(e);
        setIndexStatus({ loaded: false, count: 0, error: errorMsg });
      } finally {
        if (!cancelled) setIndexLoading(false);
      }
    }

    // Check if already cached
    const cached = getIndexCacheStatus(term);
    if (cached.loaded) {
      setIndexStatus({ loaded: true, count: cached.count, error: "" });
    } else {
      loadIndex();
    }

    return () => {
      cancelled = true;
    };
  }, [term]);

  // Search results (computed from cached index)
  const results = useMemo<CourseIndexEntry[]>(() => {
    if (!indexStatus.loaded) return [];
    const needle = q.trim();
    if (!needle) return [];
    return searchCourseIndex(term, needle, 20);
  }, [indexStatus.loaded, q, term]);

  const indexReady = indexStatus.loaded;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Courses</h2>

      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Term: <b>{term}</b></div>
        <IndexStatusBadge
          loading={indexLoading}
          error={indexStatus.error}
          ready={indexReady}
          count={indexStatus.count}
        />
      </div>

      {/* Index error details */}
      {indexStatus.error && (
        <div style={{ marginTop: 8, padding: 10, background: "var(--danger-bg)", borderRadius: 8, fontSize: 12, color: "var(--danger)" }}>
          <div style={{ fontWeight: 600 }}>Could not load course index:</div>
          <div style={{ marginTop: 4 }}>{indexStatus.error}</div>
          <div style={{ marginTop: 6, color: "var(--text-muted)" }}>
            Tip: Make sure the index file exists at <code>/course-index/{term}.json</code>
          </div>
        </div>
      )}

      {/* selected chips */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Selected</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {selected.length === 0 && <div style={{ color: "var(--text-faint)" }}>No courses selected.</div>}
          {selected.map((code) => (
            <div
              key={code}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                border: "1px solid var(--border-subtle)",
                borderRadius: 999,
                padding: "6px 10px",
                background: "var(--surface-2)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {code}
              <button
                onClick={() => remove(code)}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 16,
                  lineHeight: "16px",
                  color: "var(--text-muted)",
                }}
                aria-label={`Remove ${code}`}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* search */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 6 }}>Search and add courses</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "8px 10px",
            background: indexReady ? "var(--surface)" : "var(--surface-3)",
          }}
        >
          <span style={{ fontSize: 14, color: "var(--text-muted)" }}>🔎</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Type a course code or title (e.g. "FINA 2303", "econometrics")'
            disabled={!indexReady}
            style={{ border: "none", outline: "none", width: "100%", background: "transparent" }}
          />
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-subtle)" }}>
          Tip: Use course codes for the fastest results.
        </div>

        {/* list */}
        <div
          style={{
            marginTop: 10,
            maxHeight: 320,
            overflow: "auto",
            border: "1px solid var(--border-subtle)",
            borderRadius: 10,
            background: "var(--surface)",
          }}
        >
          {!indexReady && !indexStatus.error && !indexLoading && (
            <div style={{ padding: 12, color: "var(--text-faint)" }}>
              Index not loaded yet.
            </div>
          )}
          {indexLoading && (
            <div style={{ padding: 12, color: "var(--text-muted)" }}>Loading course index...</div>
          )}
          {indexReady && q.trim() === "" && (
            <div style={{ padding: 12, color: "var(--text-faint)" }}>
              Start typing to search courses.
            </div>
          )}
          {indexReady && q.trim() !== "" && results.length === 0 && (
            <div style={{ padding: 12, color: "var(--text-faint)" }}>
              No results found.
            </div>
          )}
          {indexReady && results.map((c) => {
          const on = selected.includes(c.course_code);
          
          // Compute matching label based on matching_type
          let matchingLabel: string | null = null;
          if (c.matching_required) {
            if (c.matching_type === "both") matchingLabel = "L+LA+T matching";
            else if (c.matching_type === "lab") matchingLabel = "L+LA matching";
            else if (c.matching_type === "tutorial") matchingLabel = "L+T matching";
            else matchingLabel = "Matching req.";
          }
          return (
            <div key={c.course_code} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 10, borderBottom: "1px solid var(--border-faint)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>
                  {c.course_code}
                  {matchingLabel && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 10,
                        fontWeight: 600,
                        background: "var(--warn-bg)",
                        color: "var(--warn-text)",
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                      title={c.header_remarks?.join(" | ") ?? "Matching between lecture and section required"}
                    >
                      {matchingLabel}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
                <div style={{ fontSize: 11, color: "var(--text-subtle)", marginTop: 2 }}>
                  {c.subject ? `${c.subject} • ` : ""}{c.units ?? "-"} units
                </div>
              </div>
              <button
                onClick={() => (on ? remove(c.course_code) : add(c.course_code))}
                disabled={on}
                style={{
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: on ? "var(--selected-bg)" : "var(--surface)",
                  fontWeight: 700,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                {on ? "Added" : "+ Add"}
              </button>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
