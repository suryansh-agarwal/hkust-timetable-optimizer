"use client";

import { useEffect, useRef, useState, useMemo, type ReactNode } from "react";
import { loadCourseIndex, searchCourseIndex, getIndexCacheStatus, getCourseFromIndex, fetchCourseSections, CourseIndexEntry } from "@/lib/api";
import type { CourseSections, SectionLock } from "@/lib/api";
import { optionsFor, reconcilePins, matchingAppliesTo } from "@/lib/sectionOptions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";

function samePins(a: SectionLock, b: SectionLock) {
  return a.lecture === b.lecture && a.tutorial === b.tutorial && a.lab === b.lab;
}

function summarise(s: { meetings: { day: string; start: string; end: string }[] }) {
  if (s.meetings.length === 0) return "no meetings";
  const days = s.meetings.map((m) => m.day).join("/");
  return `${days} ${s.meetings[0].start}`;
}

// Base UI treats value="" as "nothing selected" (SelectRoot.js:185), which
// would make "Any" unselectable and show the placeholder in its place. Carry a
// sentinel through the control and map it back to "" at the state boundary:
// "" is what setPin, setLock and the /optimize/ranked payload all expect.
const ANY = "__any";

/*
 * SelectContent is `w-(--anchor-width)` with a 144px floor, and Base UI sets
 * --anchor-width from the trigger - it never widens for its own content. These
 * three controls are the only ones whose labels are data-driven: a section
 * reads "L1 \u00b7 Tu/Th 10:30AM" and an instructor entry in the 2610 index runs
 * up to 111 characters. At the floor those were cut off with no ellipsis, so
 * let the popup size to its content instead, bounded so a long name wraps the
 * item rather than the page.
 */
const POPUP = "w-auto min-w-(--anchor-width) max-w-80";

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
  const [indexStatus, setIndexStatus] = useState<{ loaded: boolean; error: string }>({
    loaded: false,
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
    // Changing or clearing the lecture re-narrows the other components, so any
    // tutorial/lab pin derived from the old lecture is stale - including one
    // narrowing auto-selected, which the student never chose and would
    // otherwise keep being sent to the optimiser. Drop them and let
    // reconcilePins re-derive from the new lecture.
    // `?? ""` so selecting a professor on a course with no lecture pin is not
    // read as a lecture change and does not wipe a tutorial the student chose.
    if (kind === "lecture" && (current.lecture ?? "") !== value) {
      delete updated.tutorial;
      delete updated.lab;
    }
    setSectionLocks({ ...sectionLocks, [courseCode]: updated });
  }

  // Load index when term changes
  useEffect(() => {
    let cancelled = false;

    async function loadIndex() {
      setIndexLoading(true);
      setIndexStatus({ loaded: false, error: "" });

      try {
        await loadCourseIndex(term);
        if (cancelled) return;
        setIndexStatus({ loaded: true, error: "" });
      } catch (e: unknown) {
        if (cancelled) return;
        const errorMsg = e instanceof Error ? e.message : String(e);
        setIndexStatus({ loaded: false, error: errorMsg });
      } finally {
        if (!cancelled) setIndexLoading(false);
      }
    }

    // Check if already cached
    const cached = getIndexCacheStatus(term);
    if (cached.loaded) {
      setIndexStatus({ loaded: true, error: "" });
    } else {
      loadIndex();
    }

    return () => {
      cancelled = true;
    };
  }, [term]);

  // Keyed by `${term}:${code}`, matching api.ts's own cache key, so a course
  // code shared between terms can never be read as already-fetched or
  // reconciled against the wrong term's sections.
  const [sectionData, setSectionData] = useState<Record<string, CourseSections>>({});
  const [sectionFailed, setSectionFailed] = useState<Record<string, boolean>>({});
  // Tracks which `${term}:${code}` keys have an in-flight or completed
  // request, independent of React state, so the fetch effect below never
  // issues a second request for a key it has already started.
  const requested = useRef<Set<string>>(new Set());

  // Section data is per course and fetched on demand, so a student who picks
  // five courses pays for five small requests rather than a doubled index.
  // Depends on [term, selected] only - not on sectionData - because each
  // completed fetch writes sectionData, which would otherwise re-trigger this
  // effect and re-request whatever was still in flight. The `requested` ref is
  // what makes a key fetch-once instead.
  useEffect(() => {
    const missing = selected.filter((code) => !requested.current.has(`${term}:${code}`));
    if (missing.length === 0) return;

    // Concurrent, not sequential: a student who adds five courses should not
    // wait for five round trips in series before the last one's controls
    // appear. Safe to fan out because the backend takes a per-subject file
    // lock around the WCQ scrape, so two courses in the same subject queue on
    // that lock instead of scraping twice.
    //
    // No cancellation flag: every request is already in flight by the time the
    // selection could change, so there is nothing left to stop. The writes are
    // keyed by term and course and idempotent, which makes a late arrival a
    // harmless cache fill rather than a wrong render.
    for (const code of missing) {
      const key = `${term}:${code}`;
      requested.current.add(key);
      fetchCourseSections(term, code)
        .then((data) => {
          setSectionData((prev) => ({ ...prev, [key]: data }));
          setSectionFailed((prev) => {
            if (!prev[key]) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
          });
        })
        .catch(() => {
          // Un-mark so a later run can retry, and record the failure so the
          // course falls back to the professor-only control instead of
          // sitting on "Loading sections...".
          requested.current.delete(key);
          setSectionFailed((prev) => ({ ...prev, [key]: true }));
        });
    }
  }, [term, selected]);

  // reconcilePins is idempotent, so this settles in one pass: it only writes
  // when a pin was dropped or auto-filled.
  useEffect(() => {
    let changed = false;
    const next: Record<string, SectionLock> = {};

    for (const code of selected) {
      const data = sectionData[`${term}:${code}`];
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
  }, [term, selected, sectionData, sectionLocks, setSectionLocks]);

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
    <div>
      <h2 className="text-lg font-semibold">Courses</h2>

      {/* Index error details */}
      {indexStatus.error && (
        <div className="mt-6 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
          <div className="font-semibold">Could not load course index:</div>
          <div className="mt-1">{indexStatus.error}</div>
          <div className="mt-1 text-muted-foreground">
            Tip: Make sure the index file exists at <code>/course-index/{term}.json</code>
          </div>
        </div>
      )}

      {/* selected courses, each with an optional professor lock */}
      <div className="mt-6">
        <div className="mb-2 text-sm text-muted-foreground">Selected</div>
        <div className="flex flex-wrap gap-2">
          {selected.length === 0 && (
            <div className="flex w-full items-center justify-center p-6 text-sm text-muted-foreground">
              No courses selected.
            </div>
          )}
          {selected.map((code) => {
            const instructors = getCourseFromIndex(term, code)?.instructors ?? [];
            const onlyOne = instructors.length === 1;
            return (
              <Card key={code} size="sm" className="min-w-[200px] bg-muted px-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{code}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(code)}
                    aria-label={`Remove ${code}`}
                    title="Remove"
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>

                {(() => {
                  const sectionKey = `${term}:${code}`;
                  const data = sectionData[sectionKey];
                  const pins = sectionLocks[code] ?? {};
                  if (!data) {
                    if (sectionFailed[sectionKey]) {
                      // Section fetch failed permanently: fall back to the
                      // professor-only control that shipped in 6bf408d,
                      // rather than let instructor locking silently
                      // disappear because of an unrelated fetch failure.
                      return instructors.length > 0 ? (
                        <Select
                          value={locks[code] || ANY}
                          disabled={onlyOne}
                          onValueChange={(v) => setLock(code, v === ANY ? "" : String(v))}
                          items={
                            onlyOne
                              ? [{ value: ANY, label: instructors[0] }]
                              : [
                                  { value: ANY, label: "Any professor" },
                                  ...instructors.map((n) => ({ value: n, label: n })),
                                ]
                          }
                        >
                          <SelectTrigger
                            size="sm"
                            className="w-full"
                            aria-label={`Professor for ${code}`}
                            title={onlyOne ? "Only one instructor teaches this course" : "Only use sections taught by this professor"}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className={POPUP}>
                            {onlyOne ? (
                              <SelectItem value={ANY}>{instructors[0]}</SelectItem>
                            ) : (
                              <>
                                <SelectItem value={ANY}>Any professor</SelectItem>
                                {instructors.map((name) => (
                                  <SelectItem key={name} value={name}>{name}</SelectItem>
                                ))}
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      ) : null;
                    }
                    return instructors.length > 0 ? (
                      <div className="text-xs text-muted-foreground">Loading sections…</div>
                    ) : null;
                  }

                  const lectures = optionsFor(data, "LEC");
                  // Course codes carry a space ("ACCT 2200"), which is invalid in an id
                  // attribute - getElementById copes, querySelector throws.
                  const idBase = code.replaceAll(" ", "-");
                  const rows: ReactNode[] = [];

                  if (lectures.length > 0 || instructors.length > 1) {
                    const profItems = instructors.length > 1
                      ? [{ items: instructors.map((n) => ({ value: `prof:${n}`, label: n })) }]
                      : [];
                    const lecItems = lectures.length > 0
                      ? [{ items: lectures.map((s) => ({ value: s.section, label: `${s.section} · ${summarise(s)}` })) }]
                      : [];

                    rows.push(
                      <div key="lec" className="flex flex-col gap-1">
                        <Label htmlFor={`lec-${idBase}`} className="text-xs font-normal text-muted-foreground">
                          Lecture
                        </Label>
                        <Select
                          value={pins.lecture || (locks[code] ? `prof:${locks[code]}` : ANY)}
                          onValueChange={(value) => {
                            const v = String(value);
                            if (v.startsWith("prof:")) {
                              setLock(code, v.slice(5));
                              setPin(code, "lecture", "");
                            } else {
                              setLock(code, "");
                              setPin(code, "lecture", v === ANY ? "" : v);
                            }
                          }}
                          /* Every entry must be a group: isGroupedItems inspects
                             items[0] alone, so a flat entry first would make Base UI
                             read the whole array as flat, find no matches, and fall
                             back to showing raw values (`prof:CHAN, Tai Man`, `L1`).
                             That is why "Any" is wrapped in a group of one. */
                          items={[{ items: [{ value: ANY, label: "Any" }] }, ...profItems, ...lecItems]}
                        >
                          <SelectTrigger id={`lec-${idBase}`} size="sm" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className={POPUP}>
                            <SelectItem value={ANY}>Any</SelectItem>
                            {/* Same threshold the prune effect above applies. A
                                course with one instructor has nothing to choose,
                                and offering the name anyway made the control
                                snap back to "Any" the moment it was picked. */}
                            {instructors.length > 1 && (
                              <SelectGroup>
                                <SelectLabel>Professor</SelectLabel>
                                {instructors.map((n) => (
                                  <SelectItem key={n} value={`prof:${n}`}>{n}</SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            {lectures.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Lecture</SelectLabel>
                                {lectures.map((s) => (
                                  <SelectItem key={s.section} value={s.section}>
                                    {s.section} · {summarise(s)}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  }

                  // A lecture-less course schedules exactly one of its sections,
                  // so the backend rejects any pin on it rather than silently
                  // dropping one. Do not offer a control the request cannot
                  // honour; the Lecture/professor row above still renders.
                  for (const kind of lectures.length > 0 ? (["TUT", "LAB"] as const) : []) {
                    const key = kind === "TUT" ? "tutorial" : "lab";
                    const options = optionsFor(data, kind, pins.lecture);
                    if (options.length === 0) continue;
                    const auto = matchingAppliesTo(data, kind) && !!pins.lecture && options.length === 1;
                    rows.push(
                      <div key={kind} className="flex flex-col gap-1">
                        <Label htmlFor={`${key}-${idBase}`} className="text-xs font-normal text-muted-foreground">
                          {kind === "TUT" ? "Tutorial" : "Lab"}
                        </Label>
                        <Select
                          value={pins[key] || ANY}
                          disabled={auto}
                          onValueChange={(v) => setPin(code, key, v === ANY ? "" : String(v))}
                          items={[
                            ...(auto ? [] : [{ value: ANY, label: "Any" }]),
                            ...options.map((s) => ({ value: s.section, label: `${s.section} · ${summarise(s)}` })),
                          ]}
                        >
                          <SelectTrigger
                            id={`${key}-${idBase}`}
                            size="sm"
                            className="w-full"
                            title={auto ? "Determined by the lecture you picked" : undefined}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className={POPUP}>
                            {!auto && <SelectItem value={ANY}>Any</SelectItem>}
                            {options.map((s) => (
                              <SelectItem key={s.section} value={s.section}>
                                {s.section} · {summarise(s)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  }

                  return <>{rows}</>;
                })()}
              </Card>
            );
          })}
        </div>
      </div>

      {/* search */}
      <div className="mt-6">
        <div className="mb-2 text-sm text-muted-foreground">Search and add courses</div>
        <div
          className={`flex items-center gap-2 rounded-xl border border-border px-3 py-2 ${indexReady ? "bg-card" : "bg-muted"}`}
        >
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Type a course code or title (e.g. "FINA 2303", "econometrics")'
            disabled={!indexReady}
            className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:border-0 focus-visible:ring-0"
          />
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Tip: Use course codes for the fastest results.
        </div>

        {/* list */}
        <div className="mt-2 max-h-80 overflow-auto rounded-xl border border-border bg-card">
          {!indexReady && !indexStatus.error && !indexLoading && (
            <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
              Index not loaded yet.
            </div>
          )}
          {indexLoading && (
            <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">Loading course index...</div>
          )}
          {indexReady && q.trim() === "" && (
            <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
              Start typing to search courses.
            </div>
          )}
          {indexReady && q.trim() !== "" && results.length === 0 && (
            <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
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
            <div key={c.course_code} className="flex justify-between gap-2 border-b border-border p-3">
              <div className="min-w-0">
                <div className="font-semibold">
                  {c.course_code}
                  {matchingLabel && (
                    <Badge
                      variant="secondary"
                      className="ml-2"
                      title={c.header_remarks?.join(" | ") ?? "Matching between lecture and section required"}
                    >
                      {matchingLabel}
                    </Badge>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">{c.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {c.subject ? `${c.subject} • ` : ""}{c.units ?? "-"} units
                </div>
              </div>
              <Button
                variant={on ? "default" : "outline"}
                size="sm"
                onClick={() => (on ? remove(c.course_code) : add(c.course_code))}
                disabled={on}
                className="shrink-0"
              >
                {on ? "Added" : "+ Add"}
              </Button>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
