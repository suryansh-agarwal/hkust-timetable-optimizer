"use client";

import { createClient } from "@/lib/supabase/client";

import { useEffect, useMemo, useRef, useState } from "react";
import { optimizeRanked, Prefs, SectionLock } from "@/lib/api";
import {
  bonusLabel,
  computeStatsFromMeetings,
  flattenSchedule,
  formatDayList,
  makePinId,
  minutesToTime,
  penaltyLabel,
  type Bonus,
  type Penalty,
  type Pinned,
} from "@/lib/schedule";
import { TimetableGrid, CompareTimetableGrid } from "../components/TimetableGrid";
import { CoursePicker } from "../components/CoursePicker";
import { Header } from "../components/Header";
import { PreferencesPanel } from "../components/PreferencesPanel";
import {
  DAYS,
  GAP_WEIGHTS,
  EARLY_LATE_WEIGHTS,
  validateTimeConstraints,
  useDayPrefs,
  useWeightPrefs,
} from "../components/usePreferences";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";


const TERM_OPTIONS = [
  { value: "2610", label: "2026 Fall" },
  { value: "2540", label: "2026 Summer" },
  { value: "2530", label: "2026 Spring" },
] as const;

const DEFAULT_TERM = "2610";

// Base UI treats value="" as "nothing selected" (SelectRoot.js:185), so the
// "(select)" item would be unselectable and the trigger would fall back to the
// placeholder. Carry a sentinel through the control and map it back to "" at
// the state boundary, because compareA/compareB feed the compare view as "".
const NO_SELECTION = "__none";

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

  const hard = useDayPrefs();
  const soft = useDayPrefs();
  const weights = useWeightPrefs();

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
    const conflicts = validateTimeConstraints(hard.noBefore, hard.noAfter, soft.noBefore, soft.noAfter, DAYS);
    if (conflicts.length > 0) {
      setError(`Conflicting time preferences detected:\n${conflicts.join("\n")}\n\nPlease adjust your preferences so that "no classes before" times are earlier than "no classes after" times for the same day.`);
      return;
    }

    setLoading(true);

    // Build hard_no_after from enabled days only
    const hardNoAfterPayload: Record<string, string> = {};
    for (const d of DAYS) {
      if (hard.noAfter[d].enabled) {
        hardNoAfterPayload[d] = hard.noAfter[d].time;
      }
    }

    // Build hard_no_before from enabled days only
    const hardNoBeforePayload: Record<string, string> = {};
    for (const d of DAYS) {
      if (hard.noBefore[d].enabled) {
        hardNoBeforePayload[d] = hard.noBefore[d].time;
      }
    }

    // Build soft_no_after from enabled days only
    const softNoAfterPayload: Record<string, string> = {};
    for (const d of DAYS) {
      if (soft.noAfter[d].enabled) {
        softNoAfterPayload[d] = soft.noAfter[d].time;
      }
    }

    // Build soft_no_before from enabled days only
    const softNoBeforePayload: Record<string, string> = {};
    for (const d of DAYS) {
      if (soft.noBefore[d].enabled) {
        softNoBeforePayload[d] = soft.noBefore[d].time;
      }
    }

    const prefs: Prefs = {
      prefer_one_free_day: weights.preferOneFreeDay,
      gap_shape: weights.gapShape,
      hard_free_days: hard.freeDays,
      hard_no_after: hardNoAfterPayload,
      hard_no_before: hardNoBeforePayload,
      soft_free_days: soft.freeDays,
      soft_no_after: softNoAfterPayload,
      soft_no_before: softNoBeforePayload,
      weights: {
        gaps_per_min: GAP_WEIGHTS[weights.gapWeightPreset],
        late_after_per_min: EARLY_LATE_WEIGHTS[weights.earlyLateWeightPreset],
        early_before_per_min: EARLY_LATE_WEIGHTS[weights.earlyLateWeightPreset],
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
      <Header
        email={email}
        loading={loading}
        optimizeDisabled={loading || selectedCourses.length === 0}
        onShowHelp={() => setShowHelp(true)}
        onOptimize={runOptimize}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
          <div className="mb-3">
            <Label htmlFor="term-select" className="mb-2 block text-sm">Term</Label>
            <Select
              value={term}
              onValueChange={(v) => handleTermChange(String(v))}
              items={TERM_OPTIONS as unknown as { value: string; label: string }[]}
            >
              <SelectTrigger id="term-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TERM_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

        <PreferencesPanel hard={hard} soft={soft} weights={weights} error={error} />
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
                    <Input
                      type="text"
                      value={p.name}
                      onChange={(e) => renamePin(p.id, e.target.value)}
                      aria-label={`Rename ${p.name}`}
                      className="h-auto w-36 border-0 bg-transparent p-0 text-sm font-semibold shadow-none focus-visible:ring-0"
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
                  <Label htmlFor="compare-a" className="text-sm font-semibold">Option A:</Label>
                  <Select
                    value={compareA || NO_SELECTION}
                    onValueChange={(v) => setCompareA(v === NO_SELECTION ? "" : String(v))}
                    items={[
                      { value: NO_SELECTION, label: "(select)" },
                      ...pinned.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  >
                    <SelectTrigger id="compare-a" size="sm" className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SELECTION}>(select)</SelectItem>
                      {pinned.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                  <Label htmlFor="compare-b" className="text-sm font-semibold">Option B:</Label>
                  <Select
                    value={compareB || NO_SELECTION}
                    onValueChange={(v) => setCompareB(v === NO_SELECTION ? "" : String(v))}
                    items={[
                      { value: NO_SELECTION, label: "(select)" },
                      ...pinned.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  >
                    <SelectTrigger id="compare-b" size="sm" className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SELECTION}>(select)</SelectItem>
                      {pinned.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
        {/* DialogContent's base class hardcodes `sm:max-w-sm`. tailwind-merge treats
            `max-w-*` and `sm:max-w-*` as separate groups, so an unprefixed `max-w-2xl`
            alone loses to that base class at >=640px (Tailwind emits `.sm:max-w-sm`
            after `.max-w-2xl`). Repeat the width at the `sm:` breakpoint so it wins. */}
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
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
