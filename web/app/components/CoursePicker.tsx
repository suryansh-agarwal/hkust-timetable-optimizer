"use client";

import { useEffect, useState, useMemo, type ReactNode } from "react";
import { loadCourseIndex, searchCourseIndex, getIndexCacheStatus, getCourseFromIndex, fetchCourseSections, CourseIndexEntry } from "@/lib/api";
import type { CourseSections, SectionLock } from "@/lib/api";
import { optionsFor, reconcilePins } from "@/lib/sectionOptions";

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

function samePins(a: SectionLock, b: SectionLock) {
  return a.lecture === b.lecture && a.tutorial === b.tutorial && a.lab === b.lab;
}

function summarise(s: { meetings: { day: string; start: string; end: string }[] }) {
  if (s.meetings.length === 0) return "no meetings";
  const days = s.meetings.map((m) => m.day).join("/");
  return `${days} ${s.meetings[0].start}`;
}

export function CoursePicker(props: Readonly<{
  term: string;
  selected: string[];
  setSelected: (codes: string[]) => void;
  locks: Record<string, string>;
  setLocks: (locks: Record<string, string>) => void;
  sectionLocks: Record<string, SectionLock>;
  setSectionLocks: (locks: Record<string, SectionLock>) => void;
}>) {
  const { term, selected, setSelected, locks, setLocks, sectionLocks, setSectionLocks } = props;

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

  function setLock(courseCode: string, instructor: string) {
    const next = { ...locks };
    if (instructor) {
      next[courseCode] = instructor;
    } else {
      delete next[courseCode];
    }
    setLocks(next);
  }

  function setPin(courseCode: string, kind: "lecture" | "tutorial" | "lab", value: string) {
    const current = sectionLocks[courseCode] ?? {};
    const updated: SectionLock = { ...current };
    if (value) {
      updated[kind] = value;
    } else {
      delete updated[kind];
    }
    setSectionLocks({ ...sectionLocks, [courseCode]: updated });
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

  const [sectionData, setSectionData] = useState<Record<string, CourseSections>>({});

  // Section data is per course and fetched on demand, so a student who picks
  // five courses pays for five small requests rather than a doubled index.
  useEffect(() => {
    let cancelled = false;
    const missing = selected.filter((code) => !sectionData[code]);
    if (missing.length === 0) return;

    (async () => {
      for (const code of missing) {
        try {
          const data = await fetchCourseSections(term, code);
          if (cancelled) return;
          setSectionData((prev) => ({ ...prev, [code]: data }));
        } catch {
          // A course whose sections cannot be loaded simply offers no pins.
          // The optimiser still works; only the picker is degraded.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [term, selected, sectionData]);

  // Section data is per term; drop it when the term changes.
  useEffect(() => {
    setSectionData({});
  }, [term]);

  // reconcilePins is idempotent, so this settles in one pass: it only writes
  // when a pin was dropped or auto-filled.
  useEffect(() => {
    let changed = false;
    const next: Record<string, SectionLock> = {};

    for (const code of selected) {
      const data = sectionData[code];
      const current = sectionLocks[code] ?? {};
      if (!data) {
        if (Object.keys(current).length > 0) next[code] = current;
        continue;
      }
      const reconciled = reconcilePins(data, current);
      if (Object.keys(reconciled).length > 0) next[code] = reconciled;
      // Field-by-field, not JSON.stringify: pins loaded from Postgres can
      // arrive with their keys in any order, and a string comparison would
      // see that as a change on every render.
      if (!samePins(reconciled, current)) changed = true;
    }

    if (changed || Object.keys(next).length !== Object.keys(sectionLocks).length) {
      setSectionLocks(next);
    }
  }, [selected, sectionData, sectionLocks, setSectionLocks]);

  // A persisted lock outlives the index it came from. If a rebuilt index
  // leaves the course with one instructor the select renders disabled, and
  // with none it does not render at all - either way the name is no longer a
  // selectable option, so the user cannot clear the lock, yet it is still sent
  // on every optimise and blocks the request. Prune it once the index is up.
  useEffect(() => {
    if (!indexStatus.loaded) return;

    const next: Record<string, string> = {};
    for (const code of selected) {
      const lock = locks[code];
      if (!lock) continue;
      const instructors = getCourseFromIndex(term, code)?.instructors ?? [];
      // Fewer than two instructors means the select offers no name to pick.
      if (instructors.length > 1 && instructors.includes(lock)) {
        next[code] = lock;
      }
    }

    const currentCodes = Object.keys(locks);
    const changed =
      currentCodes.length !== Object.keys(next).length ||
      currentCodes.some((code) => next[code] !== locks[code]);
    // Only write when something actually changed, otherwise this effect
    // re-triggers itself on the new `locks` identity forever.
    if (changed) setLocks(next);
  }, [indexStatus.loaded, term, selected, locks, setLocks]);

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

      {/* selected courses, each with an optional professor lock */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Selected</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {selected.length === 0 && <div style={{ color: "var(--text-faint)" }}>No courses selected.</div>}
          {selected.map((code) => {
            const instructors = getCourseFromIndex(term, code)?.instructors ?? [];
            const onlyOne = instructors.length === 1;
            return (
              <div
                key={code}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 10,
                  padding: "8px 10px",
                  background: "var(--surface-2)",
                  fontSize: 13,
                  minWidth: 200,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600 }}>{code}</span>
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

                {(() => {
                  const data = sectionData[code];
                  const pins = sectionLocks[code] ?? {};
                  if (!data) {
                    return instructors.length > 0 ? (
                      <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Loading sections…</div>
                    ) : null;
                  }

                  const lectures = optionsFor(data, "LEC");
                  const rows: ReactNode[] = [];

                  if (lectures.length > 0 || instructors.length > 0) {
                    rows.push(
                      <label key="lec" style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "var(--text-muted)" }}>
                        Lecture
                        <select
                          value={pins.lecture ?? (locks[code] ? `prof:${locks[code]}` : "")}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v.startsWith("prof:")) {
                              setLock(code, v.slice(5));
                              setPin(code, "lecture", "");
                            } else {
                              setLock(code, "");
                              setPin(code, "lecture", v);
                            }
                          }}
                          style={{ padding: 4, fontSize: 12, borderRadius: 6, maxWidth: 240 }}
                        >
                          <option value="">Any</option>
                          {instructors.length > 0 && (
                            <optgroup label="Professor">
                              {instructors.map((n) => (
                                <option key={n} value={`prof:${n}`}>{n}</option>
                              ))}
                            </optgroup>
                          )}
                          {lectures.length > 0 && (
                            <optgroup label="Lecture">
                              {lectures.map((s) => (
                                <option key={s.section} value={s.section}>
                                  {s.section} · {summarise(s)}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </label>
                    );
                  }

                  for (const kind of ["TUT", "LAB"] as const) {
                    const key = kind === "TUT" ? "tutorial" : "lab";
                    const options = optionsFor(data, kind, pins.lecture);
                    if (options.length === 0) continue;
                    const auto = data.matching_required && !!pins.lecture && options.length === 1;
                    rows.push(
                      <label key={kind} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "var(--text-muted)" }}>
                        {kind === "TUT" ? "Tutorial" : "Lab"}
                        <select
                          value={pins[key] ?? ""}
                          disabled={auto}
                          onChange={(e) => setPin(code, key, e.target.value)}
                          title={auto ? "Determined by the lecture you picked" : undefined}
                          style={{ padding: 4, fontSize: 12, borderRadius: 6, maxWidth: 240 }}
                        >
                          {!auto && <option value="">Any</option>}
                          {options.map((s) => (
                            <option key={s.section} value={s.section}>
                              {s.section} · {summarise(s)}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  }

                  return <>{rows}</>;
                })()}
              </div>
            );
          })}
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
