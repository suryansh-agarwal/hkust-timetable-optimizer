"use client";

import { createClient } from "@/lib/supabase/client";

import { useEffect, useMemo, useState } from "react";
import { optimizeRanked, Prefs } from "@/lib/api";
import { TimetableGrid, CompareTimetableGrid } from "../components/TimetableGrid";
import { CoursePicker } from "../components/CoursePicker";


const DAYS = ["Mo", "Tu", "We", "Th", "Fr"] as const;
const TERM_OPTIONS = [
  { value: "2530", label: "2026 Spring" },
  { value: "2540", label: "2026 Summer" },
] as const;

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

  // Latest end time across week
  let latestEnd = -1;
  for (const m of meetings) latestEnd = Math.max(latestEnd, m.end_min);

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
    earliestStartMin: earliestStart === 99999 ? null : earliestStart,
    gapsMin,
  };
}

function formatDayList(days: string[]) {
  if (days.length === 0) return "(none)";
  return days.join(", ");
}

function penaltyLabel(p: { type: string; day?: string; cutoff?: string; minutes?: number }) {
  // make the labels less ugly than raw types
  if (p.type === "soft_no_after") return `After cutoff (${p.day} ${p.cutoff})`;
  if (p.type === "gaps_minutes") return `Gaps (${p.minutes} min)`;
  if (p.type === "hard_free_day_violation") return `Hard free day violated (${p.day})`;
  return p.type;
}

function bonusLabel(b: { type: string; value?: number }) {
  if (b.type === "free_days") return `Free days (+${b.value})`;
  if (b.type === "compact_days") return `Compact days (+${b.value})`;
  return b.type;
}


export default function Home() {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("none");
  const [userId, setUserId] = useState<string | null>(null);
  const [term, setTerm] = useState("2530");
  const [showHelp, setShowHelp] = useState(true);

  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [selectionsLoaded, setSelectionsLoaded] = useState(false);

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
        setSelectionsLoaded(true);
        return;
      }

      const { data: row, error } = await supabase
        .from("user_course_selections")
        .select("courses")
        .eq("user_id", uid)
        .eq("term", term)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.warn("Failed to load course selections", error);
        setSelectedCourses([]);
      } else {
        setSelectedCourses(row?.courses ?? []);
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
  }, [supabase, userId, term, selectedCourses, selectionsLoaded]);

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
  const [compactDays, setCompactDays] = useState(true);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ results: { score: number; breakdown: { penalties?: unknown[]; bonuses?: unknown[] }; schedule: unknown[] }[]; considered: number; returned: number } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState<string>("");

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
      compact_days: compactDays,
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
      const data = await optimizeRanked(term, selectedCourses, prefs, 5);
      setResult(data);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }

  const active = result?.results?.[activeIdx];
  const meetings = useMemo(() => (active ? flattenSchedule(active.schedule) : []), [active]);
  
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px", fontFamily: "system-ui", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>HKUST Timetable Optimizer</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: "#666" }}>
            Build a schedule with soft and hard preferences
          </div>
          <div><b>Logged in as:</b> {email}</div>
        </div>
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          style={{
            border: "1px solid #ddd",
            background: "white",
            borderRadius: 10,
            padding: "8px 12px",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          How to use?
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
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
            setSelected={setSelectedCourses}
          />
          <div style={{ marginTop: 8, fontSize: 14 }}>
            <b>Selected:</b> {selectedCourses.join(", ")}
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14, maxHeight: 520, overflowY: "auto" }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Preferences</h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
            <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, background: "#fafafa" }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Hard constraints</div>

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

            <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Soft preferences</div>

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
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#333" }}>
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
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#333" }}>
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
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, fontSize: 13, color: "#333" }}>
              <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="checkbox" checked={preferOneFreeDay} onChange={(e) => setPreferOneFreeDay(e.target.checked)} />
                Prefer at least one free weekday
              </label>

              <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="checkbox" checked={compactDays} onChange={(e) => setCompactDays(e.target.checked)} />
                Prefer compact days (fewer gaps)
              </label>
            </div>
          </div>

          <button onClick={runOptimize} disabled={loading || selectedCourses.length === 0} style={{ marginTop: 12, width: "100%", padding: "10px 12px", fontWeight: 700 }}>
            {loading ? "Optimizing..." : "Optimize"}
          </button>

          {error && <div style={{ marginTop: 8, color: "crimson", whiteSpace: "pre-wrap" }}>{error}</div>}
        </div>
      </div>

      {result && (
        <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700 }}>Results</div>
              <div style={{ fontSize: 13, color: "#666" }}>
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
              const penalties = (r.breakdown?.penalties ?? []) as { type: string; day?: string; cutoff?: string; minutes?: number }[];
              const bonuses = (r.breakdown?.bonuses ?? []) as { type: string; value?: number }[];

              return (
                <div
                  key={i}
                  style={{
                    position: "relative",
                    textAlign: "left",
                    borderRadius: 14,
                    border: isActive ? "2px solid #111" : "1px solid #ddd",
                    background: "white",
                    padding: 12,
                    cursor: "pointer",
                    boxShadow: isActive ? "0 2px 10px rgba(0,0,0,0.08)" : "none",
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
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          pinResultOption(r, i);
                        }}
                        style={{
                          border: isPinned ? "1px solid #1d4ed8" : "1px solid #ddd",
                          background: isPinned ? "#e0ecff" : "#fafafa",
                          borderRadius: 8,
                          padding: "4px 8px",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                          color: isPinned ? "#1d4ed8" : "#111",
                        }}
                        title={isPinned ? "Pinned" : "Pin this option for comparison"}
                      >
                        {isPinned ? "✅ Pinned" : "📌 Pin"}
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: 8, fontSize: 13, color: "#444", lineHeight: 1.35 }}>
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
                      Latest end: <b>{stats.latestEndMin >= 0 ? minutesToTime(stats.latestEndMin) : "-"}</b>
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
                          background: "#fff1f1",
                          border: "1px solid #ffd6d6",
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
                          background: "#f1fff3",
                          border: "1px solid #c9f3d0",
                        }}
                        title={JSON.stringify(b)}
                      >
                        ✅ {bonusLabel(b)}
                      </span>
                    ))}
                    {penalties.length === 0 && bonuses.length === 0 && (
                      <span style={{ fontSize: 12, color: "#777" }}>No notable tradeoffs</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700 }}>Score: {active?.score.toFixed(1)}</div>
            <div style={{ fontSize: 13, color: "#555" }}>
              {(active?.breakdown?.penalties as { type: string }[] | undefined)?.map((p, idx: number) => (
                <span key={idx} style={{ marginRight: 8 }}>❌ {p.type}</span>
              ))}
              {(active?.breakdown?.bonuses as { type: string }[] | undefined)?.map((b, idx: number) => (
                <span key={idx} style={{ marginRight: 8 }}>✅ {b.type}</span>
              ))}
            </div>
          </div>

          {/* simple per-day list view (Stage 6 can be a real grid) */}
          <div style={{ marginTop: 10 }}>
            <TimetableGrid meetings={meetings} startHour={8} endHour={20} />
          </div>

          {/* ---- Compare Section ---- */}
          <div style={{ marginTop: 20, borderTop: "1px solid #eee", paddingTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Compare Timetables</div>
                <div style={{ fontSize: 13, color: "#666" }}>
                  Pin options above, then select two to overlay and compare
                </div>
              </div>
              <div style={{ fontSize: 13, color: "#888" }}>{pinned.length} pinned</div>
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
                      border: "1px solid #e6e6e6",
                      borderRadius: 8,
                      padding: "6px 10px",
                      background: "#fafafa",
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
                    <span style={{ fontSize: 12, color: "#888" }}>{p.score.toFixed(1)}</span>
                    <button
                      type="button"
                      onClick={() => unpin(p.id)}
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        fontSize: 14,
                        color: "#999",
                        padding: 0,
                        lineHeight: 1,
                      }}
                      title="Unpin"
                    >
                      ×
                    </button>
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
                      background: "rgba(239, 68, 68, 0.3)",
                      border: "1px solid rgba(239, 68, 68, 0.5)",
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
                      background: "rgba(59, 130, 246, 0.3)",
                      border: "1px solid rgba(59, 130, 246, 0.5)",
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
                <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
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
              <div style={{ marginTop: 12, fontSize: 13, color: "#888", fontStyle: "italic" }}>
                Pin at least 2 options to enable comparison
              </div>
            )}
          </div>

        </div>
      )}
      {showHelp && (
        <>
          <button
            type="button"
            aria-label="Close help"
            onClick={() => setShowHelp(false)}
            style={{
              position: "fixed",
              inset: 0,
              border: "none",
              background: "rgba(0, 0, 0, 0.35)",
              padding: 0,
              margin: 0,
              zIndex: 40,
            }}
          />
          <dialog
            open
            aria-label="How to use HKUST Timetable Optimizer"
            style={{
              border: "none",
              padding: 0,
              background: "transparent",
              position: "fixed",
              inset: 0,
              width: "100%",
              height: "100%",
              margin: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 50,
            }}
          >
            <div
              style={{
                background: "white",
                borderRadius: 14,
                padding: 20,
                width: "100%",
                maxWidth: 760,
                maxHeight: "85vh",
                overflowY: "auto",
                boxShadow: "0 12px 30px rgba(0,0,0,0.2)",
              }}
            >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>How to use</div>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                aria-label="Close"
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: 20,
                  cursor: "pointer",
                  color: "#666",
                }}
              >
                ×
              </button>
            </div>
            <div style={{ marginTop: 12, fontSize: 14, color: "#444", lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700 }}>1) Choose a term</div>
              <div style={{ marginBottom: 10 }}>
                Pick “2026 Spring” or “2026 Summer”. The label is just for clarity, but it loads the right term data behind the scenes.
              </div>

              <div style={{ fontWeight: 700 }}>2) Add courses</div>
              <div style={{ marginBottom: 10 }}>
                Use the search box to find a course by code or title, then click “Add”. Selected courses show as chips you can remove.
              </div>

              <div style={{ fontWeight: 700 }}>3) Set preferences</div>
              <div style={{ marginBottom: 10 }}>
                <div><b>Hard</b> preferences are strict rules (e.g. “Must be free on Tue”). Any schedule that violates them is rejected.</div>
                <div><b>Soft</b> preferences are scored (e.g. “No classes after 5pm”). The optimizer tries to minimize these penalties.</div>
              </div>

              <div style={{ fontWeight: 700 }}>4) Optimize</div>
              <div style={{ marginBottom: 10 }}>
                Click “Optimize” to generate the best schedules. Each option shows a score and key tradeoffs. (it may take up to a minute to load the results)
              </div>

              <div style={{ fontWeight: 700 }}>5) Compare results</div>
              <div style={{ marginBottom: 10 }}>
                Pin options you like, then select two to overlay and compare. This helps you choose between close tradeoffs.
              </div>
            </div>
          </div>
          </dialog>
        </>
      )}
    </div>
  );
}
