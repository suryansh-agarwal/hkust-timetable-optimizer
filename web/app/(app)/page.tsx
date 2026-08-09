"use client";

import { createClient } from "@/lib/supabase/client";

import { useEffect, useMemo, useRef, useState } from "react";
import { optimizeRanked, Prefs, SectionLock } from "@/lib/api";
import { TimetableGrid, CompareTimetableGrid } from "../components/TimetableGrid";
import { CoursePicker } from "../components/CoursePicker";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Info, MessageSquare, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";


const DAYS = ["Mo", "Tu", "We", "Th", "Fr"] as const;
const TERM_OPTIONS = [
  { value: "2610", label: "2026 Fall" },
  { value: "2540", label: "2026 Summer" },
  { value: "2530", label: "2026 Spring" },
] as const;

const DEFAULT_TERM = "2610";

// Time options for soft no-after (12:00–20:00 in 30-min steps)
function genNoAfterTimes(): string[] {
  const times: string[] = [];
  for (let h = 12; h <= 20; h++) {
    times.push(`${h.toString().padStart(2, "0")}:00`);
    if (h < 20) times.push(`${h.toString().padStart(2, "0")}:30`);
  }
  return times;
}

// Time options for soft no-before (09:00–15:00 in 30-min steps)
function genNoBeforeTimes(): string[] {
  const times: string[] = [];
  for (let h = 9; h <= 15; h++) {
    times.push(`${h.toString().padStart(2, "0")}:00`);
    if (h < 15) times.push(`${h.toString().padStart(2, "0")}:30`);
  }
  return times;
}

// Convert "HH:MM" to minutes since midnight
function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Validate that no-before and no-after constraints don't conflict on the same day
function validateTimeConstraints(
  hardNoBefore: Record<string, { enabled: boolean; time: string }>,
  hardNoAfter: Record<string, { enabled: boolean; time: string }>,
  softNoBefore: Record<string, { enabled: boolean; time: string }>,
  softNoAfter: Record<string, { enabled: boolean; time: string }>,
  days: readonly string[]
): string[] {
  const conflicts: string[] = [];

  for (const d of days) {
    // Collect all no-before times for this day (both hard and soft)
    const noBeforeTimes: { type: string; time: number }[] = [];
    if (hardNoBefore[d]?.enabled) {
      noBeforeTimes.push({ type: "hard", time: timeToMinutes(hardNoBefore[d].time) });
    }
    if (softNoBefore[d]?.enabled) {
      noBeforeTimes.push({ type: "soft", time: timeToMinutes(softNoBefore[d].time) });
    }

    // Collect all no-after times for this day (both hard and soft)
    const noAfterTimes: { type: string; time: number }[] = [];
    if (hardNoAfter[d]?.enabled) {
      noAfterTimes.push({ type: "hard", time: timeToMinutes(hardNoAfter[d].time) });
    }
    if (softNoAfter[d]?.enabled) {
      noAfterTimes.push({ type: "soft", time: timeToMinutes(softNoAfter[d].time) });
    }

    // Check for conflicts: if no-before >= no-after, it's impossible
    for (const nb of noBeforeTimes) {
      for (const na of noAfterTimes) {
        if (nb.time >= na.time) {
          const nbTimeStr = hardNoBefore[d]?.enabled && nb.type === "hard" ? hardNoBefore[d].time : softNoBefore[d].time;
          const naTimeStr = hardNoAfter[d]?.enabled && na.type === "hard" ? hardNoAfter[d].time : softNoAfter[d].time;
          conflicts.push(
            `${d}: "no classes before ${nbTimeStr}" (${nb.type}) conflicts with "no classes after ${naTimeStr}" (${na.type})`
          );
        }
      }
    }
  }

  return conflicts;
}

const NO_AFTER_TIMES = genNoAfterTimes();
const NO_BEFORE_TIMES = genNoBeforeTimes();

// Weight presets
const GAP_WEIGHTS = { Low: 0.05, Med: 0.10, High: 0.20 } as const;
const EARLY_LATE_WEIGHTS = { Low: 0.25, Med: 0.50, High: 1.00 } as const;
type WeightPreset = "Low" | "Med" | "High";
type GapShape = "no_preference" | "consolidated" | "fragmented";

// Per-day soft constraint state
type SoftDayPref = { enabled: boolean; time: string };

function minutesToTime(m: number) {
  const hh = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

type Meeting = { day: string; start_min: number; end_min: number; course_code: string; section: string };

// ---- Pin types ----
type Pinned = {
  id: string;
  name: string;
  term: string;
  sourceIdx: number;
  score: number;
  breakdown: unknown;
  schedule: unknown[];
  createdAt: number;
};

function makePinId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function flattenSchedule(schedule: unknown[]): Meeting[] {
  const out: Meeting[] = [];
  for (const c of schedule as { course_code: string; parts: { section: string; meetings: { day: string; start_min: number; end_min: number }[] }[] }[]) {
    for (const p of c.parts) {
      for (const mtg of p.meetings) {
        out.push({
          day: mtg.day,
          start_min: mtg.start_min,
          end_min: mtg.end_min,
          course_code: c.course_code,
          section: p.section,
        });
      }
    }
  }
  return out;
}

function computeStatsFromMeetings(meetings: Meeting[]) {
  const days = ["Mo", "Tu", "We", "Th", "Fr"];
  const byDay: Record<string, Meeting[]> = { Mo: [], Tu: [], We: [], Th: [], Fr: [] };
  for (const m of meetings) {
    if (byDay[m.day]) byDay[m.day].push(m);
  }

  const usedDays = days.filter((d) => byDay[d].length > 0);
  const freeDays = days.filter((d) => byDay[d].length === 0);

  // Latest end time across the week, and the day it falls on - "18:50" alone
  // does not tell you which day you are stuck on campus until the evening.
  let latestEnd = -1;
  let latestEndDay: string | null = null;
  for (const m of meetings) {
    if (m.end_min > latestEnd) {
      latestEnd = m.end_min;
      latestEndDay = m.day;
    }
  }

  // Total gaps per day (time between consecutive classes)
  let gapsMin = 0;
  for (const d of usedDays) {
    const arr = [...byDay[d]].sort((a, b) => a.start_min - b.start_min);
    for (let i = 1; i < arr.length; i++) {
      const gap = arr[i].start_min - arr[i - 1].end_min;
      if (gap > 0) gapsMin += gap;
    }
  }

  // Earliest start
  let earliestStart = 99999;
  for (const m of meetings) earliestStart = Math.min(earliestStart, m.start_min);

  return {
    usedDaysCount: usedDays.length,
    freeDaysCount: freeDays.length,
    freeDays,
    latestEndMin: latestEnd,
    latestEndDay,
    earliestStartMin: earliestStart === 99999 ? null : earliestStart,
    gapsMin,
  };
}

function formatDayList(days: string[]) {
  if (days.length === 0) return "(none)";
  return days.join(", ");
}

type Penalty = { type: string; day?: string; cutoff?: string; minutes?: number; shape?: string };
type Bonus = { type: string; day?: string; count?: number; value?: number };

// Covers every penalty type scoring.py can emit. Anything unlabelled falls
// through to its raw name, which is what used to leak "soft_no_before" into
// the UI, so add a case here when adding a penalty.
function penaltyLabel(p: Penalty) {
  if (p.type === "soft_no_after") return `After cutoff (${p.day} ${p.cutoff})`;
  if (p.type === "soft_no_before") return `Before cutoff (${p.day} ${p.cutoff})`;
  if (p.type === "soft_free_day") return `${p.day} not free`;
  if (p.type === "gaps_minutes") {
    const shapeLabel =
      p.shape === "consolidated" ? ", prefer 1 long" : p.shape === "fragmented" ? ", prefer short" : "";
    return `Gaps (${Math.round((p.minutes ?? 0) * 10) / 10} min${shapeLabel})`;
  }
  if (p.type === "hard_free_day_violation") return `Hard free day violated (${p.day})`;
  return p.type;
}

function bonusLabel(b: Bonus) {
  if (b.type === "free_days") return `Free days (+${b.value})`;
  if (b.type === "soft_free_day") return `${b.day} free`;
  return b.type;
}


export default function Home() {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("none");
  const [userId, setUserId] = useState<string | null>(null);
  const [term, setTerm] = useState<string>(DEFAULT_TERM);
  const [showHelp, setShowHelp] = useState(true);

  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [instructorLocks, setInstructorLocks] = useState<Record<string, string>>({});
  const [sectionLocks, setSectionLocks] = useState<Record<string, SectionLock>>({});
  const [selectionsLoaded, setSelectionsLoaded] = useState(false);

  // A lock for a course that is no longer selected would be sent to the API
  // and silently constrain nothing, so drop it at the point of removal.
  function handleSetSelectedCourses(codes: string[]) {
    setSelectedCourses(codes);
    setInstructorLocks((prev) => {
      const next: Record<string, string> = {};
      for (const code of codes) {
        if (prev[code]) next[code] = prev[code];
      }
      return next;
    });
    setSectionLocks((prev) => {
      const next: Record<string, SectionLock> = {};
      for (const code of codes) {
        if (prev[code]) next[code] = prev[code];
      }
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function loadUserAndSelections() {
      setSelectionsLoaded(false);
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;

      if (cancelled) return;

      setEmail(data.user?.email ?? "none");
      setUserId(uid);

      if (!uid) {
        setSelectedCourses([]);
        setInstructorLocks({});
        setSectionLocks({});
        setSelectionsLoaded(true);
        return;
      }

      const { data: row, error } = await supabase
        .from("user_course_selections")
        .select("courses, instructor_locks, section_locks")
        .eq("user_id", uid)
        .eq("term", term)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.warn("Failed to load course selections", error);
        setSelectedCourses([]);
        setInstructorLocks({});
        setSectionLocks({});
      } else {
        setSelectedCourses(row?.courses ?? []);
        setInstructorLocks(row?.instructor_locks ?? {});
        setSectionLocks(row?.section_locks ?? {});
      }

      setSelectionsLoaded(true);
    }

    loadUserAndSelections();
    return () => {
      cancelled = true;
    };
  }, [supabase, term]);

  useEffect(() => {
    if (!userId || !selectionsLoaded) return;

    const handle = setTimeout(() => {
      (async () => {
        const { error } = await supabase
          .from("user_course_selections")
          .upsert(
            {
              user_id: userId,
              term,
              courses: selectedCourses,
              instructor_locks: instructorLocks,
              section_locks: sectionLocks,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,term" }
          );

        if (error) {
          console.warn("Failed to save course selections", error);
        }
      })();
    }, 400);

    return () => clearTimeout(handle);
  }, [supabase, userId, term, selectedCourses, instructorLocks, sectionLocks, selectionsLoaded]);

  // Hard free days (multi-select)
  const [hardFreeDays, setHardFreeDays] = useState<string[]>([]);
  const [softFreeDays, setSoftFreeDays] = useState<string[]>([]);

  // Per-day hard no-after constraints
  const [hardNoAfter, setHardNoAfter] = useState<Record<string, SoftDayPref>>(() => {
    const init: Record<string, SoftDayPref> = {};
    for (const d of DAYS) init[d] = { enabled: false, time: "15:00" };
    return init;
  });

  // Per-day hard no-before constraints
  const [hardNoBefore, setHardNoBefore] = useState<Record<string, SoftDayPref>>(() => {
    const init: Record<string, SoftDayPref> = {};
    for (const d of DAYS) init[d] = { enabled: false, time: "09:00" };
    return init;
  });

  // Per-day soft no-after constraints
  const [softNoAfter, setSoftNoAfter] = useState<Record<string, SoftDayPref>>(() => {
    const init: Record<string, SoftDayPref> = {};
    for (const d of DAYS) init[d] = { enabled: false, time: "15:00" };
    return init;
  });

  // Per-day soft no-before constraints
  const [softNoBefore, setSoftNoBefore] = useState<Record<string, SoftDayPref>>(() => {
    const init: Record<string, SoftDayPref> = {};
    for (const d of DAYS) init[d] = { enabled: false, time: "09:00" };
    return init;
  });

  // Weight presets
  const [gapWeightPreset, setGapWeightPreset] = useState<WeightPreset>("Med");
  const [earlyLateWeightPreset, setEarlyLateWeightPreset] = useState<WeightPreset>("Med");

  const [preferOneFreeDay, setPreferOneFreeDay] = useState(true);
  const [gapShape, setGapShape] = useState<GapShape>("no_preference");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ results: { score: number; breakdown: { penalties?: unknown[]; bonuses?: unknown[] }; schedule: unknown[] }[]; considered: number; returned: number } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState<string>("");
  const [didJustOptimize, setDidJustOptimize] = useState(false);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  // ---- Pin + Compare state ----
  const [pinned, setPinned] = useState<Pinned[]>([]);
  const [compareA, setCompareA] = useState<string>(""); // pinned id
  const [compareB, setCompareB] = useState<string>(""); // pinned id

  // Reset when term changes
  const handleTermChange = (newTerm: string) => {
    setTerm(newTerm);
  };

  function pinResultOption(r: { score: number; breakdown: unknown; schedule: unknown[] }, idx: number) {
    if (pinned.some((p) => p.term === term && p.sourceIdx === idx)) return;
    const id = makePinId();
    const name = `Pinned #${pinned.length + 1} (Opt ${idx + 1})`;
    const item: Pinned = {
      id,
      name,
      term,
      sourceIdx: idx,
      score: r.score,
      breakdown: r.breakdown,
      schedule: r.schedule,
      createdAt: Date.now(),
    };
    setPinned([item, ...pinned]);
  }

  function unpin(id: string) {
    setPinned(pinned.filter((p) => p.id !== id));
    if (compareA === id) setCompareA("");
    if (compareB === id) setCompareB("");
  }

  function renamePin(id: string, name: string) {
    setPinned(pinned.map((p) => (p.id === id ? { ...p, name } : p)));
  }

  const pinnedA = pinned.find((p) => p.id === compareA) ?? null;
  const pinnedB = pinned.find((p) => p.id === compareB) ?? null;

  const meetingsA = useMemo(() => (pinnedA ? flattenSchedule(pinnedA.schedule) : []), [pinnedA]);
  const meetingsB = useMemo(() => (pinnedB ? flattenSchedule(pinnedB.schedule) : []), [pinnedB]);

  async function runOptimize() {
    setError("");
    setResult(null);
    setActiveIdx(0);
    setDidJustOptimize(false);

    // Validate time constraints before running
    const conflicts = validateTimeConstraints(hardNoBefore, hardNoAfter, softNoBefore, softNoAfter, DAYS);
    if (conflicts.length > 0) {
      setError(`Conflicting time preferences detected:\n${conflicts.join("\n")}\n\nPlease adjust your preferences so that "no classes before" times are earlier than "no classes after" times for the same day.`);
      return;
    }

    setLoading(true);

    // Build hard_no_after from enabled days only
    const hardNoAfterPayload: Record<string, string> = {};
    for (const d of DAYS) {
      if (hardNoAfter[d].enabled) {
        hardNoAfterPayload[d] = hardNoAfter[d].time;
      }
    }

    // Build hard_no_before from enabled days only
    const hardNoBeforePayload: Record<string, string> = {};
    for (const d of DAYS) {
      if (hardNoBefore[d].enabled) {
        hardNoBeforePayload[d] = hardNoBefore[d].time;
      }
    }

    // Build soft_no_after from enabled days only
    const softNoAfterPayload: Record<string, string> = {};
    for (const d of DAYS) {
      if (softNoAfter[d].enabled) {
        softNoAfterPayload[d] = softNoAfter[d].time;
      }
    }

    // Build soft_no_before from enabled days only
    const softNoBeforePayload: Record<string, string> = {};
    for (const d of DAYS) {
      if (softNoBefore[d].enabled) {
        softNoBeforePayload[d] = softNoBefore[d].time;
      }
    }

    const prefs: Prefs = {
      prefer_one_free_day: preferOneFreeDay,
      gap_shape: gapShape,
      hard_free_days: hardFreeDays,
      hard_no_after: hardNoAfterPayload,
      hard_no_before: hardNoBeforePayload,
      soft_free_days: softFreeDays,
      soft_no_after: softNoAfterPayload,
      soft_no_before: softNoBeforePayload,
      weights: {
        gaps_per_min: GAP_WEIGHTS[gapWeightPreset],
        late_after_per_min: EARLY_LATE_WEIGHTS[earlyLateWeightPreset],
        early_before_per_min: EARLY_LATE_WEIGHTS[earlyLateWeightPreset],
      },
    };

    try {
      const data = await optimizeRanked(term, selectedCourses, prefs, 6, instructorLocks, sectionLocks);

      // Must return before setResult: no ok:false response carries a `results`
      // key, and the results renderer calls result.results.map() unguarded.
      // Not every ok:false carries blocked_by_lock - "course codes
      // not found" does not - so key off ok alone.
      if (data?.ok === false) {
        setError(data.error ?? "Could not build a timetable for this request.");
        return;
      }

      setResult(data);
      const resultCount = data?.results?.length ?? 0;
      if (resultCount === 0) {
        toast.error("Timetable not possible with current subjects");
      } else {
        setDidJustOptimize(true);
      }
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }

  const active = result?.results?.[activeIdx];
  const meetings = useMemo(() => (active ? flattenSchedule(active.schedule) : []), [active]);

  useEffect(() => {
    if (!didJustOptimize) return;
    if ((result?.results?.length ?? 0) > 0) {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setDidJustOptimize(false);
  }, [didJustOptimize, result]);
  
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px", fontFamily: "system-ui", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>HKUST Timetable Optimizer</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-muted)" }}>
            Build a schedule with soft and hard preferences
          </div>
          <div><b>Logged in as:</b> {email}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ThemeToggle />
          <a
            href="https://docs.google.com/forms/d/e/1FAIpQLSdUPWeLVqBYbBbZunz-tPnI3mvgGDgKN2onmYPKlZ13OcwNUA/viewform?usp=publish-editor"
            target="_blank"
            rel="noreferrer"
            aria-label="Leave feedback"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <MessageSquare className="size-4" aria-hidden />
            Feedback
          </a>
          <Button variant="outline" size="sm" onClick={() => setShowHelp(true)}>
            How to use?
          </Button>
          <Button
            size="sm"
            onClick={runOptimize}
            disabled={loading || selectedCourses.length === 0}
          >
            {loading ? "Optimizing..." : "Optimize"}
          </Button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
          <div style={{ marginBottom: 10 }}>
            <label htmlFor="term-select" style={{ display: "block", fontSize: 14, marginBottom: 6 }}>
              Term
            </label>
            <select
              id="term-select"
              value={term}
              onChange={(e) => handleTermChange(e.target.value)}
              style={{ padding: 8, width: "100%" }}
            >
              {TERM_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <CoursePicker
            term={term}
            selected={selectedCourses}
            setSelected={handleSetSelectedCourses}
            locks={instructorLocks}
            setLocks={setInstructorLocks}
            sectionLocks={sectionLocks}
            setSectionLocks={setSectionLocks}
          />
          <div style={{ marginTop: 8, fontSize: 14 }}>
            <b>Selected:</b> {selectedCourses.join(", ")}
          </div>
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, maxHeight: 520, overflowY: "auto" }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Preferences</h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
            <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 10, padding: 12, background: "var(--surface-2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                <span>Hard preferences</span>
                <Dialog>
                  <DialogTrigger
                    aria-label="About hard preferences"
                    className="inline-flex size-5 items-center justify-center rounded-full border border-border text-xs font-bold text-muted-foreground hover:bg-muted"
                  >
                    <Info className="size-3" aria-hidden />
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Hard preferences</DialogTitle>
                      <DialogDescription>
                        Hard preferences are non-negotiable constraints. If a timetable
                        violates one, it is rejected.
                      </DialogDescription>
                    </DialogHeader>
                    <ul className="ml-4 list-disc text-sm text-foreground">
                      <li>No classes before 10:30</li>
                      <li>Keep Friday completely free</li>
                      <li>Avoid clashes (required)</li>
                    </ul>
                  </DialogContent>
                </Dialog>
              </div>

              {/* Hard Free Days (multi-select) */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Must be free</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {DAYS.map((d) => (
                    <label key={d} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={hardFreeDays.includes(d)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setHardFreeDays([...hardFreeDays, d]);
                          } else {
                            setHardFreeDays(hardFreeDays.filter((x) => x !== d));
                          }
                        }}
                      />
                      {d}
                    </label>
                  ))}
                </div>
              </div>

              {/* Hard No Classes After */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>No classes after</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {DAYS.map((d) => (
                    <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, width: 50 }}>
                        <input
                          type="checkbox"
                          checked={hardNoAfter[d].enabled}
                          onChange={(e) =>
                            setHardNoAfter({ ...hardNoAfter, [d]: { ...hardNoAfter[d], enabled: e.target.checked } })
                          }
                        />
                        {d}
                      </label>
                      <select
                        value={hardNoAfter[d].time}
                        disabled={!hardNoAfter[d].enabled}
                        onChange={(e) =>
                          setHardNoAfter({ ...hardNoAfter, [d]: { ...hardNoAfter[d], time: e.target.value } })
                        }
                        style={{ padding: 4, fontSize: 12, borderRadius: 4, opacity: hardNoAfter[d].enabled ? 1 : 0.5 }}
                      >
                        {NO_AFTER_TIMES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Hard No Classes Before */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>No classes before</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {DAYS.map((d) => (
                    <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, width: 50 }}>
                        <input
                          type="checkbox"
                          checked={hardNoBefore[d].enabled}
                          onChange={(e) =>
                            setHardNoBefore({ ...hardNoBefore, [d]: { ...hardNoBefore[d], enabled: e.target.checked } })
                          }
                        />
                        {d}
                      </label>
                      <select
                        value={hardNoBefore[d].time}
                        disabled={!hardNoBefore[d].enabled}
                        onChange={(e) =>
                          setHardNoBefore({ ...hardNoBefore, [d]: { ...hardNoBefore[d], time: e.target.value } })
                        }
                        style={{ padding: 4, fontSize: 12, borderRadius: 4, opacity: hardNoBefore[d].enabled ? 1 : 0.5 }}
                      >
                        {NO_BEFORE_TIMES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                <span>Soft preferences</span>
                <Dialog>
                  <DialogTrigger
                    aria-label="About soft preferences"
                    className="inline-flex size-5 items-center justify-center rounded-full border border-border text-xs font-bold text-muted-foreground hover:bg-muted"
                  >
                    <Info className="size-3" aria-hidden />
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Soft preferences</DialogTitle>
                      <DialogDescription>
                        Soft preferences are nice-to-haves. The optimiser will try to
                        satisfy them, but may trade them off to find a feasible timetable.
                      </DialogDescription>
                    </DialogHeader>
                    <ul className="ml-4 list-disc text-sm text-foreground">
                      <li>Minimize gaps between classes</li>
                      <li>Prefer compact schedules</li>
                      <li>Prefer fewer days on campus</li>
                    </ul>
                  </DialogContent>
                </Dialog>
              </div>

              {/* Soft Free Days (multi-select) */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Prefer free</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {DAYS.map((d) => (
                    <label key={d} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={softFreeDays.includes(d)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSoftFreeDays([...softFreeDays, d]);
                          } else {
                            setSoftFreeDays(softFreeDays.filter((x) => x !== d));
                          }
                        }}
                      />
                      {d}
                    </label>
                  ))}
                </div>
              </div>

              {/* Soft No Classes After */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>No classes after</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {DAYS.map((d) => (
                    <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, width: 50 }}>
                        <input
                          type="checkbox"
                          checked={softNoAfter[d].enabled}
                          onChange={(e) =>
                            setSoftNoAfter({ ...softNoAfter, [d]: { ...softNoAfter[d], enabled: e.target.checked } })
                          }
                        />
                        {d}
                      </label>
                      <select
                        value={softNoAfter[d].time}
                        disabled={!softNoAfter[d].enabled}
                        onChange={(e) =>
                          setSoftNoAfter({ ...softNoAfter, [d]: { ...softNoAfter[d], time: e.target.value } })
                        }
                        style={{ padding: 4, fontSize: 12, borderRadius: 4, opacity: softNoAfter[d].enabled ? 1 : 0.5 }}
                      >
                        {NO_AFTER_TIMES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Soft No Classes Before */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>No classes before</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {DAYS.map((d) => (
                    <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, width: 50 }}>
                        <input
                          type="checkbox"
                          checked={softNoBefore[d].enabled}
                          onChange={(e) =>
                            setSoftNoBefore({ ...softNoBefore, [d]: { ...softNoBefore[d], enabled: e.target.checked } })
                          }
                        />
                        {d}
                      </label>
                      <select
                        value={softNoBefore[d].time}
                        disabled={!softNoBefore[d].enabled}
                        onChange={(e) =>
                          setSoftNoBefore({ ...softNoBefore, [d]: { ...softNoBefore[d], time: e.target.value } })
                        }
                        style={{ padding: 4, fontSize: 12, borderRadius: 4, opacity: softNoBefore[d].enabled ? 1 : 0.5 }}
                      >
                        {NO_BEFORE_TIMES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>

          {/* Weights + style prefs (outside soft box) */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Weights & style</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-body)" }}>
                <span style={{ width: 140 }}>Gap penalty:</span>
                <select
                  value={gapWeightPreset}
                  onChange={(e) => setGapWeightPreset(e.target.value as WeightPreset)}
                  style={{ padding: 6, fontSize: 13, borderRadius: 6 }}
                >
                  <option value="Low">Low</option>
                  <option value="Med">Med</option>
                  <option value="High">High</option>
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-body)" }}>
                <span style={{ width: 140 }}>Early/late penalty:</span>
                <select
                  value={earlyLateWeightPreset}
                  onChange={(e) => setEarlyLateWeightPreset(e.target.value as WeightPreset)}
                  style={{ padding: 6, fontSize: 13, borderRadius: 6 }}
                >
                  <option value="Low">Low</option>
                  <option value="Med">Med</option>
                  <option value="High">High</option>
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-body)" }}>
                <span style={{ width: 140 }}>Gap shape:</span>
                <select
                  value={gapShape}
                  onChange={(e) => setGapShape(e.target.value as GapShape)}
                  style={{ padding: 6, fontSize: 13, borderRadius: 6 }}
                >
                  <option value="no_preference">No preference</option>
                  <option value="consolidated">Prefer one long gap</option>
                  <option value="fragmented">Prefer several short gaps</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, fontSize: 13, color: "var(--text-body)" }}>
              <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="checkbox" checked={preferOneFreeDay} onChange={(e) => setPreferOneFreeDay(e.target.checked)} />
                Prefer at least one free weekday
              </label>
            </div>
          </div>

          {error && <div style={{ marginTop: 8, color: "var(--danger)", whiteSpace: "pre-wrap" }}>{error}</div>}
        </div>
      </div>

      <div ref={resultsRef} id="results" style={{ scrollMarginTop: 90 }}>
        {result && (
          <div style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700 }}>Results</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                considered {result.considered}, returned {result.returned}
              </div>
            </div>
          </div>

          {/* Schedule cards */}
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {result.results.map((r, i: number) => {
              const ms = flattenSchedule(r.schedule);
              const stats = computeStatsFromMeetings(ms);

              const isActive = i === activeIdx;
              const isPinned = pinned.some((p) => p.term === term && p.sourceIdx === i);
              // The gaps penalty and the free-days bonus are already stated
              // exactly above as "Gaps: N min" and "Free days: N (...)", so as
              // chips they only repeat the numbers in a noisier form.
              const penalties = ((r.breakdown?.penalties ?? []) as Penalty[])
                .filter((p) => p.type !== "gaps_minutes");
              const bonuses = ((r.breakdown?.bonuses ?? []) as Bonus[])
                .filter((b) => b.type !== "free_days");

              return (
                <div
                  key={i}
                  style={{
                    position: "relative",
                    textAlign: "left",
                    borderRadius: 14,
                    border: isActive ? "2px solid var(--active-border)" : "1px solid var(--border)",
                    background: "var(--surface)",
                    padding: 12,
                    cursor: "pointer",
                    boxShadow: isActive ? "var(--shadow-md)" : "none",
                  }}
                  onClick={() => setActiveIdx(i)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setActiveIdx(i); }}
                  role="button"
                  tabIndex={0}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>Option #{i + 1}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ fontWeight: 900, fontSize: 16 }}>Score {r.score.toFixed(1)}</div>
                      <Button
                        variant={isPinned ? "default" : "outline"}
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          pinResultOption(r, i);
                        }}
                        title={isPinned ? "Pinned" : "Pin this option for comparison"}
                      >
                        {isPinned ? "✅ Pinned" : "📌 Pin"}
                      </Button>
                    </div>
                  </div>

                  <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-body)", lineHeight: 1.35 }}>
                    <div>
                      Free days: <b>{stats.freeDaysCount}</b> ({formatDayList(stats.freeDays)})
                    </div>
                    <div>
                      Days on campus: <b>{stats.usedDaysCount}</b>
                    </div>
                    <div>
                      Gaps: <b>{stats.gapsMin}</b> min
                    </div>
                    <div>
                      Latest end:{" "}
                      <b>
                        {stats.latestEndMin >= 0
                          ? `${stats.latestEndDay ?? ""} ${minutesToTime(stats.latestEndMin)}`.trim()
                          : "-"}
                      </b>
                    </div>
                  </div>

                  {/* quick breakdown chips */}
                  <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {penalties.slice(0, 3).map((p, idx: number) => (
                      <span
                        key={`p-${idx}`}
                        style={{
                          fontSize: 12,
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: "var(--danger-chip-bg)",
                          border: "1px solid var(--danger-border)",
                        }}
                        title={JSON.stringify(p)}
                      >
                        ❌ {penaltyLabel(p)}
                      </span>
                    ))}
                    {bonuses.slice(0, 2).map((b, idx: number) => (
                      <span
                        key={`b-${idx}`}
                        style={{
                          fontSize: 12,
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: "var(--success-bg)",
                          border: "1px solid var(--success-border)",
                        }}
                        title={JSON.stringify(b)}
                      >
                        ✅ {bonusLabel(b)}
                      </span>
                    ))}
                    {penalties.length === 0 && bonuses.length === 0 && (
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>No notable tradeoffs</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700 }}>Score: {active?.score.toFixed(1)}</div>
            <div style={{ fontSize: 13, color: "var(--text-body)" }}>
              {/* Same two omissions as the cards above: the gaps penalty and
                  the free-days bonus are already stated per option, so
                  repeating them here adds nothing. */}
              {(active?.breakdown?.penalties as Penalty[] | undefined)
                ?.filter((p) => p.type !== "gaps_minutes")
                .map((p, idx: number) => (
                  <span key={idx} style={{ marginRight: 8 }}>❌ {penaltyLabel(p)}</span>
                ))}
              {(active?.breakdown?.bonuses as Bonus[] | undefined)
                ?.filter((b) => b.type !== "free_days")
                .map((b, idx: number) => (
                  <span key={idx} style={{ marginRight: 8 }}>✅ {bonusLabel(b)}</span>
                ))}
            </div>
          </div>

          {/* simple per-day list view (Stage 6 can be a real grid) */}
          <div style={{ marginTop: 10 }}>
            <TimetableGrid meetings={meetings} startHour={8} endHour={20} />
          </div>

          {/* ---- Compare Section ---- */}
          <div style={{ marginTop: 20, borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Compare Timetables</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Pin options above, then select two to overlay and compare
                </div>
              </div>
              <div style={{ fontSize: 13, color: "var(--text-subtle)" }}>{pinned.length} pinned</div>
            </div>

            {/* Pinned items list */}
            {pinned.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {pinned.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 8,
                      padding: "6px 10px",
                      background: "var(--surface-2)",
                      fontSize: 13,
                    }}
                  >
                    <input
                      type="text"
                      value={p.name}
                      onChange={(e) => renamePin(p.id, e.target.value)}
                      style={{
                        border: "none",
                        background: "transparent",
                        fontWeight: 600,
                        width: 140,
                        fontSize: 13,
                      }}
                    />
                    <span style={{ fontSize: 12, color: "var(--text-subtle)" }}>{p.score.toFixed(1)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => unpin(p.id)}
                      title="Unpin"
                      aria-label="Unpin"
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Compare selectors */}
            {pinned.length >= 2 && (
              <div style={{ marginTop: 14, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      background: "hsl(var(--cmp-a) / 0.3)",
                      border: "1px solid hsl(var(--cmp-a) / 0.6)",
                    }}
                  />
                  <label htmlFor="compare-a" style={{ fontSize: 13, fontWeight: 600 }}>Option A:</label>
                  <select
                    id="compare-a"
                    value={compareA}
                    onChange={(e) => setCompareA(e.target.value)}
                    style={{ padding: 6, fontSize: 13, borderRadius: 6 }}
                  >
                    <option value="">(select)</option>
                    {pinned.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      background: "hsl(var(--cmp-b) / 0.3)",
                      border: "1px solid hsl(var(--cmp-b) / 0.6)",
                    }}
                  />
                  <label htmlFor="compare-b" style={{ fontSize: 13, fontWeight: 600 }}>Option B:</label>
                  <select
                    id="compare-b"
                    value={compareB}
                    onChange={(e) => setCompareB(e.target.value)}
                    style={{ padding: 6, fontSize: 13, borderRadius: 6 }}
                  >
                    <option value="">(select)</option>
                    {pinned.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Overlay comparison grid */}
            {(pinnedA || pinnedB) && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                  Hover over a class to temporarily hide the other timetable
                </div>
                <CompareTimetableGrid
                  meetingsA={meetingsA}
                  meetingsB={meetingsB}
                  startHour={8}
                  endHour={20}
                />
              </div>
            )}

            {pinned.length < 2 && (
              <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-subtle)", fontStyle: "italic" }}>
                Pin at least 2 options to enable comparison
              </div>
            )}
          </div>

          </div>
        )}
      </div>
      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>How to use</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm text-foreground">
            <section>
              <h3 className="font-bold">1) Choose a term</h3>
              <p>Pick “2026 Fall”, “2026 Summer” or “2026 Spring”. The label is just for clarity, but it loads the right term data behind the scenes.</p>
            </section>
            <section>
              <h3 className="font-bold">2) Add courses</h3>
              <p>Use the search box to find a course by code or title, then click “Add”. Selected courses show as chips you can remove.</p>
            </section>
            <section>
              <h3 className="font-bold">3) Set preferences</h3>
              <p><b>Hard</b> preferences are strict rules (e.g. “Must be free on Tue”). Any schedule that violates them is rejected.</p>
              <p><b>Soft</b> preferences are scored (e.g. “No classes after 5pm”). The optimizer tries to minimize these penalties.</p>
            </section>
            <section>
              <h3 className="font-bold">4) Optimize</h3>
              <p>Click “Optimize” to generate the best schedules. Each option shows a score and key tradeoffs. (it may take up to a minute to load the results)</p>
            </section>
            <section>
              <h3 className="font-bold">5) Compare results</h3>
              <p>Pin options you like, then select two to overlay and compare. This helps you choose between close tradeoffs.</p>
            </section>
            <section>
              <h3 className="font-bold">6) P.S.</h3>
              <p>This is a work in progress. Please report any issues or feedback to google form on the top right. Use the theme switch in the header to follow your system setting or force light or dark.</p>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
