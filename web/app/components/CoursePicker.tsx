"use client";

import { useEffect, useState } from "react";
import { catalogSearch } from "@/lib/api";

type CourseLite = { course_code: string; title: string; units?: number; subject?: string };

export function CoursePicker(props: Readonly<{
  term: string;
  catalogReady: boolean;
  selected: string[];
  setSelected: (codes: string[]) => void;
}>) {
  const { term, catalogReady, selected, setSelected } = props;

  const [q, setQ] = useState("");
  const [results, setResults] = useState<CourseLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  function add(courseCode: string) {
    if (selected.includes(courseCode)) return;
    setSelected([...selected, courseCode]);
  }

  function remove(courseCode: string) {
    setSelected(selected.filter((x) => x !== courseCode));
  }

  useEffect(() => {
    let cancelled = false;
    if (!catalogReady) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }

    const needle = q.trim();
    if (!needle) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }

    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const data = await catalogSearch(term, needle, 20);
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data?.courses ?? data?.results ?? data?.items ?? []);
        setResults(list);
        setSearchError("");
      } catch (e: any) {
        if (cancelled) return;
        setSearchError(e?.message ?? String(e));
        setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [catalogReady, q, term]);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Courses</h2>

      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "#666" }}>Term: <b>{term}</b></div>
      </div>

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
        <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Search course code or title</div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='Search (e.g. "COMP 2011" or "econometrics")'
          disabled={!catalogReady}
          style={{ padding: 8, width: "100%" }}
        />
      </div>

      {/* list */}
      <div style={{ marginTop: 10, maxHeight: 320, overflow: "auto", border: "1px solid #eee", borderRadius: 10 }}>
        {!catalogReady && (
          <div style={{ padding: 12, color: "#999" }}>
            Catalog not built; build it to enable global search.
          </div>
        )}
        {catalogReady && searching && (
          <div style={{ padding: 12, color: "#777" }}>Searching...</div>
        )}
        {catalogReady && !searching && q.trim() === "" && (
          <div style={{ padding: 12, color: "#999" }}>
            Start typing to search the catalog.
          </div>
        )}
        {catalogReady && !searching && searchError && (
          <div style={{ padding: 12, color: "crimson", whiteSpace: "pre-wrap" }}>{searchError}</div>
        )}
        {catalogReady && !searching && !searchError && q.trim() !== "" && results.length === 0 && (
          <div style={{ padding: 12, color: "#999" }}>
            No results found.
          </div>
        )}
        {catalogReady && results.map((c) => {
          const on = selected.includes(c.course_code);
          return (
            <div key={c.course_code} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 10, borderBottom: "1px solid #f3f3f3" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>{c.course_code}</div>
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
  );
}
