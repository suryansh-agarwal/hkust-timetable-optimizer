"use client";

import { createClient } from "@/lib/supabase/client";

import { useEffect, useMemo, useRef, useState } from "react";
import { optimizeRanked, Prefs, SectionLock } from "@/lib/api";
import {
  makePinId,
  type Pinned,
} from "@/lib/schedule";
import { CoursePicker } from "../components/CoursePicker";
import { Header } from "../components/Header";
import { PreferencesPanel } from "../components/PreferencesPanel";
import { ResultsList } from "../components/ResultsList";
import { CompareSection } from "../components/CompareSection";
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
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
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

  useEffect(() => {
    if (!didJustOptimize) return;
    if ((result?.results?.length ?? 0) > 0) {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setDidJustOptimize(false);
  }, [didJustOptimize, result]);
  
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 lg:px-6">
      <Header
        email={email}
        loading={loading}
        optimizeDisabled={loading || selectedCourses.length === 0}
        onShowHelp={() => setShowHelp(true)}
        onOptimize={runOptimize}
      />
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3">
            <Label htmlFor="term-select" className="mb-2 block text-sm font-semibold">Term</Label>
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
          <p className="mt-1 text-sm">
            <span className="font-semibold">Selected:</span> {selectedCourses.join(", ")}
          </p>
        </Card>

        <PreferencesPanel hard={hard} soft={soft} weights={weights} error={error} />
      </div>

      <div ref={resultsRef} id="results" className="scroll-mt-[90px]">
        {result && (
          <div className="mt-6 space-y-6">
          <ResultsList
            results={result.results}
            considered={result.considered}
            returned={result.returned}
            activeIdx={activeIdx}
            onSelectIdx={setActiveIdx}
            isPinned={(i) => pinned.some((p) => p.term === term && p.sourceIdx === i)}
            onPin={pinResultOption}
          />

          <CompareSection
            pinned={pinned}
            compareA={compareA}
            compareB={compareB}
            onCompareA={setCompareA}
            onCompareB={setCompareB}
            onUnpin={unpin}
            onRename={renamePin}
          />

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
