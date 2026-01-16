"use client";

import { useEffect, useState, useMemo } from "react";
import { loadCourseIndex, searchCourseIndex, getIndexCacheStatus, CourseIndexEntry } from "@/lib/api";

function IndexStatusBadge({ loading, error, ready, count }: Readonly<{ loading: boolean; error: string; ready: boolean; count: number }>) {
  if (loading) {
    return <span style={{ fontSize: 12, color: "#666" }}>Loading index...</span>;
  }
  if (error) {
    return <span style={{ fontSize: 12, color: "crimson" }} title={error}>⚠️ Index error</span>;
  }
  if (ready) {
    return <span style={{ fontSize: 12, color: "#22c55e" }}>✓ Index: {count.toLocaleString()} courses</span>;
  }
  return <span style={{ fontSize: 12, color: "#666" }}>Index not loaded</span>;
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
    <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Courses</h2>

      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "#666" }}>Term: <b>{term}</b></div>
        <IndexStatusBadge
          loading={indexLoading}
          error={indexStatus.error}
          ready={indexReady}
          count={indexStatus.count}
        />
      </div>

      {/* Index error details */}
      {indexStatus.error && (
        <div style={{ marginTop: 8, padding: 10, background: "#fff5f5", borderRadius: 8, fontSize: 12, color: "crimson" }}>
          <div style={{ fontWeight: 600 }}>Could not load course index:</div>
          <div style={{ marginTop: 4 }}>{indexStatus.error}</div>
          <div style={{ marginTop: 6, color: "#666" }}>
            Tip: Make sure the index file exists at <code>/course-index/{term}.json</code>
          </div>
        </div>
      )}

      {/* selected chips */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, color: "#666" }}>Selected</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {selected.length === 0 && <div style={{ color: "#999" }}>No courses selected.</div>}
          {selected.map((code) => (
            <div
              key={code}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                border: "1px solid #e6e6e6",
                borderRadius: 999,
                padding: "6px 10px",
                background: "#fafafa",
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
                  color: "#666",
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
        <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Search and add courses</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: "8px 10px",
            background: indexReady ? "white" : "#f7f7f7",
          }}
        >
          <span style={{ fontSize: 14, color: "#666" }}>🔎</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Type a course code or title (e.g. "FINA 2303", "econometrics")'
            disabled={!indexReady}
            style={{ border: "none", outline: "none", width: "100%", background: "transparent" }}
          />
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: "#888" }}>
          Tip: Use course codes for the fastest results.
        </div>

        {/* list */}
        <div
          style={{
            marginTop: 10,
            maxHeight: 320,
            overflow: "auto",
            border: "1px solid #eee",
            borderRadius: 10,
            background: "white",
          }}
        >
          {!indexReady && !indexStatus.error && !indexLoading && (
            <div style={{ padding: 12, color: "#999" }}>
              Index not loaded yet.
            </div>
          )}
          {indexLoading && (
            <div style={{ padding: 12, color: "#777" }}>Loading course index...</div>
          )}
          {indexReady && q.trim() === "" && (
            <div style={{ padding: 12, color: "#999" }}>
              Start typing to search courses.
            </div>
          )}
          {indexReady && q.trim() !== "" && results.length === 0 && (
            <div style={{ padding: 12, color: "#999" }}>
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
            <div key={c.course_code} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 10, borderBottom: "1px solid #f3f3f3" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>
                  {c.course_code}
                  {matchingLabel && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 10,
                        fontWeight: 600,
                        background: "#fef3c7",
                        color: "#92400e",
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                      title={c.header_remarks?.join(" | ") ?? "Matching between lecture and section required"}
                    >
                      {matchingLabel}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                  {c.subject ? `${c.subject} • ` : ""}{c.units ?? "-"} units
                </div>
              </div>
              <button
                onClick={() => (on ? remove(c.course_code) : add(c.course_code))}
                disabled={on}
                style={{
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: on ? "#eef7ff" : "white",
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
