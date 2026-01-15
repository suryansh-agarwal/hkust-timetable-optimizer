"use client";

import { useEffect, useMemo, useState } from "react";
import { catalogBuild, catalogStatus, optimizeRanked, Prefs, refreshQuotas } from "@/lib/api";
import { TimetableGrid, CompareTimetableGrid } from "./components/TimetableGrid";
import { CoursePicker } from "./components/CoursePicker";


const DAYS = ["Mo", "Tu", "We", "Th", "Fr"] as const;
const TERMS = ["2540","2530", "2520", "2510"] as const;

// Time options for soft no-after (12:00–20:00 in 30-min steps)
function genNoAfterTimes(): string[] {
  const times: string[] = [];
  for (let h = 12; h <= 20; h++) {
    times.push(`${h.toString().padStart(2, "0")}:00`);
    if (h < 20) times.push(`${h.toString().padStart(2, "0")}:30`);
  }
  return times;
}

// Time options for soft no-before (08:00–12:00 in 30-min steps)
function genNoBeforeTimes(): string[] {
  const times: string[] = [];
  for (let h = 8; h <= 12; h++) {
    times.push(`${h.toString().padStart(2, "0")}:00`);
    if (h < 12) times.push(`${h.toString().padStart(2, "0")}:30`);
  }
  return times;
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
  score: number;
  breakdown: any;
  schedule: any[];
  createdAt: number;
};

function makePinId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function flattenSchedule(schedule: any[]): Meeting[] {
  const out: Meeting[] = [];
  for (const c of schedule) {
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

function penaltyLabel(p: any) {
  // make the labels less ugly than raw types
  if (p.type === "soft_no_after") return `After cutoff (${p.day} ${p.cutoff})`;
  if (p.type === "gaps_minutes") return `Gaps (${p.minutes} min)`;
  if (p.type === "hard_free_day_violation") return `Hard free day violated (${p.day})`;
  return p.type;
}

function bonusLabel(b: any) {
  if (b.type === "free_days") return `Free days (+${b.value})`;
  if (b.type === "compact_days") return `Compact days (+${b.value})`;
  return b.type;
}


export default function Home() {
  const [term, setTerm] = useState("2530");

  const [selectedCourses, setSelectedCourses] = useState<string[]>(["COMP 2011", "ECON 3334", "MATH 2350"]);
  const [catalogInfo, setCatalogInfo] = useState<any>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogActionError, setCatalogActionError] = useState("");
  const [buildingCatalog, setBuildingCatalog] = useState(false);
  const [refreshingQuotas, setRefreshingQuotas] = useState(false);

  // Hard free days (multi-select)
  const [hardFreeDays, setHardFreeDays] = useState<string[]>([]);

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
  const [result, setResult] = useState<any>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState<string>("");

  // ---- Pin + Compare state ----
  const [pinned, setPinned] = useState<Pinned[]>([]);
  const [compareA, setCompareA] = useState<string>(""); // pinned id
  const [compareB, setCompareB] = useState<string>(""); // pinned id

  function pinResultOption(r: any, idx: number) {
    const id = makePinId();
    const name = `Pinned #${pinned.length + 1} (Opt ${idx + 1})`;
    const item: Pinned = {
      id,
      name,
      term,
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

  async function loadCatalogStatus() {
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const data = await catalogStatus(term);
      setCatalogInfo(data);
    } catch (e: any) {
      setCatalogError(e?.message ?? String(e));
      setCatalogInfo(null);
    } finally {
      setCatalogLoading(false);
    }
  }

  useEffect(() => {
    loadCatalogStatus();
  }, [term]);

  async function handleCatalogBuild(force = false) {
    setBuildingCatalog(true);
    setCatalogActionError("");
    try {
      await catalogBuild(term, force);
      await loadCatalogStatus();
    } catch (e: any) {
      setCatalogActionError(e?.message ?? String(e));
    } finally {
      setBuildingCatalog(false);
    }
  }

  async function handleRefreshQuotas() {
    if (selectedCourses.length === 0) return;
    setRefreshingQuotas(true);
    setCatalogActionError("");
    try {
      await refreshQuotas(term, undefined, selectedCourses);
      await loadCatalogStatus();
    } catch (e: any) {
      setCatalogActionError(e?.message ?? String(e));
    } finally {
      setRefreshingQuotas(false);
    }
  }

  async function runOptimize() {
    setLoading(true);
    setError("");
    setResult(null);
    setActiveIdx(0);

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
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  const active = result?.results?.[activeIdx];
  const meetings = useMemo(() => (active ? flattenSchedule(active.schedule) : []), [active]);
  const catalogReady = !!catalogInfo?.exists;
  const catalogAgeSec = typeof catalogInfo?.age_sec === "number" ? catalogInfo.age_sec : null;
  const catalogAgeHours = catalogAgeSec === null ? null : Math.max(0, catalogAgeSec) / 3600;
  const catalogAgeLabel = catalogAgeHours === null ? "unknown" : `${catalogAgeHours.toFixed(1)} hours ago`;
  let catalogStatusText = "Catalog missing";
  if (catalogLoading) {
    catalogStatusText = "Catalog: loading...";
  } else if (catalogReady) {
    catalogStatusText = `Catalog: built ${catalogAgeLabel}`;
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>HKUST Timetable Optimizer</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
          <div style={{ marginBottom: 10 }}>
            <label htmlFor="term-select" style={{ display: "block", fontSize: 14, marginBottom: 6 }}>
              Term
            </label>
            <select
              id="term-select"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              style={{ padding: 8, width: "100%" }}
            >
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Catalog</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13 }}>
                {catalogStatusText}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => handleCatalogBuild(false)}
                  disabled={buildingCatalog}
                  style={{ padding: "4px 8px", fontSize: 11, borderRadius: 6, border: "1px solid #ddd", fontWeight: 700 }}
                >
                  {buildingCatalog ? "Building..." : "Build catalog"}
                </button>
                <button
                  type="button"
                  onClick={() => handleCatalogBuild(true)}
                  disabled={buildingCatalog}
                  style={{ padding: "4px 8px", fontSize: 11, borderRadius: 6, border: "1px solid #ddd", fontWeight: 700 }}
                >
                  Force rebuild
                </button>
                <button
                  type="button"
                  onClick={handleRefreshQuotas}
                  disabled={refreshingQuotas || selectedCourses.length === 0}
                  style={{ padding: "4px 8px", fontSize: 11, borderRadius: 6, border: "1px solid #ddd", fontWeight: 700 }}
                >
                  {refreshingQuotas ? "Refreshing..." : "Refresh quotas (selected)"}
                </button>
              </div>
            </div>
            {catalogError && <div style={{ marginTop: 6, color: "crimson", whiteSpace: "pre-wrap" }}>{catalogError}</div>}
            {catalogActionError && <div style={{ marginTop: 6, color: "crimson", whiteSpace: "pre-wrap" }}>{catalogActionError}</div>}
          </div>

          <CoursePicker
            term={term}
            catalogReady={catalogReady}
            selected={selectedCourses}
            setSelected={setSelectedCourses}
          />
          <div style={{ marginTop: 8, fontSize: 14 }}>
            <b>Selected:</b> {selectedCourses.join(", ")}
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14, maxHeight: 520, overflowY: "auto" }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Preferences</h2>

          {/* Hard Free Days (multi-select) */}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Must be free (hard)</div>
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

          {/* Soft No Classes After */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Soft: no classes after</div>
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
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Soft: no classes before</div>
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

          {/* Weights */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Weights</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ width: 140 }}>Gap penalty:</span>
                <select
                  value={gapWeightPreset}
                  onChange={(e) => setGapWeightPreset(e.target.value as WeightPreset)}
                  style={{ padding: 4, fontSize: 12, borderRadius: 4 }}
                >
                  <option value="Low">Low</option>
                  <option value="Med">Med</option>
                  <option value="High">High</option>
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ width: 140 }}>Early/late penalty:</span>
                <select
                  value={earlyLateWeightPreset}
                  onChange={(e) => setEarlyLateWeightPreset(e.target.value as WeightPreset)}
                  style={{ padding: 4, fontSize: 12, borderRadius: 4 }}
                >
                  <option value="Low">Low</option>
                  <option value="Med">Med</option>
                  <option value="High">High</option>
                </select>
              </div>
            </div>
          </div>

          {/* Existing boolean prefs */}
          <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
            <input type="checkbox" checked={preferOneFreeDay} onChange={(e) => setPreferOneFreeDay(e.target.checked)} />
            Prefer at least one free weekday
          </label>

          <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
            <input type="checkbox" checked={compactDays} onChange={(e) => setCompactDays(e.target.checked)} />
            Prefer compact days (fewer gaps)
          </label>

          <button onClick={runOptimize} disabled={loading} style={{ marginTop: 12, width: "100%", padding: "10px 12px", fontWeight: 700 }}>
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
            {result.results.map((r: any, i: number) => {
              const ms = flattenSchedule(r.schedule);
              const stats = computeStatsFromMeetings(ms);

              const isActive = i === activeIdx;
              const penalties = (r.breakdown?.penalties ?? []) as any[];
              const bonuses = (r.breakdown?.bonuses ?? []) as any[];

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
                          border: "1px solid #ddd",
                          background: "#fafafa",
                          borderRadius: 8,
                          padding: "4px 8px",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                        title="Pin this option for comparison"
                      >
                        📌 Pin
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
                    {penalties.slice(0, 3).map((p: any, idx: number) => (
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
                    {bonuses.slice(0, 2).map((b: any, idx: number) => (
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
            <div style={{ fontWeight: 700 }}>Score: {active.score.toFixed(1)}</div>
            <div style={{ fontSize: 13, color: "#555" }}>
              {active.breakdown.penalties?.map((p: any, idx: number) => (
                <span key={idx} style={{ marginRight: 8 }}>❌ {p.type}</span>
              ))}
              {active.breakdown.bonuses?.map((b: any, idx: number) => (
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
    </div>
  );
}
