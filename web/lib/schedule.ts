/**
 * Turning an optimiser result into the facts a card displays.
 *
 * These live in lib/ rather than app/components/ so vitest can reach them -
 * vitest.config.ts includes lib/**\/*.test.ts and nothing under app/. They
 * compute the free-day, gap and latest-end numbers on every result card and
 * had no coverage before stage 3a.
 */

export function minutesToTime(m: number) {
  const hh = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

export type Meeting = { day: string; start_min: number; end_min: number; course_code: string; section: string };

// ---- Pin types ----
export type Pinned = {
  id: string;
  name: string;
  term: string;
  sourceIdx: number;
  score: number;
  breakdown: unknown;
  schedule: unknown[];
  createdAt: number;
};

export function makePinId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
export function flattenSchedule(schedule: unknown[]): Meeting[] {
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

export function computeStatsFromMeetings(meetings: Meeting[]) {
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

export function formatDayList(days: string[]) {
  if (days.length === 0) return "(none)";
  return days.join(", ");
}

export type Penalty = { type: string; day?: string; cutoff?: string; minutes?: number; shape?: string };
export type Bonus = { type: string; day?: string; count?: number; value?: number };

// Covers every penalty type scoring.py can emit. Anything unlabelled falls
// through to its raw name, which is what used to leak "soft_no_before" into
// the UI, so add a case here when adding a penalty.
export function penaltyLabel(p: Penalty) {
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

export function bonusLabel(b: Bonus) {
  if (b.type === "free_days") return `Free days (+${b.value})`;
  if (b.type === "soft_free_day") return `${b.day} free`;
  return b.type;
}

export type ScheduleStats = ReturnType<typeof computeStatsFromMeetings>;

/**
 * The best and worst value each comparative axis takes across a returned set.
 *
 * These are properties of the set, not of any one option, so they are computed
 * once by whoever holds the whole set and passed down - the same reasoning that
 * puts bestScore and worstScore in ResultsList.
 */
export type SetExtremes = {
  gapsMin: { min: number; max: number };
  usedDaysCount: { min: number; max: number };
  latestEndMin: { min: number; max: number };
};

export type ComparativeChip = { tone: "good" | "bad"; label: string };

/**
 * How far apart the best and worst option must be on an axis before that axis
 * is worth a chip.
 *
 * Without a floor, a set whose options differ by four minutes of gap would
 * label one "most gaps" and another "fewest" - technically true, and useless
 * for choosing between them. Half an hour is roughly the difference a student
 * would actually plan around; a whole day on campus always is.
 */
const SPREAD_FLOOR = { gapsMin: 30, usedDaysCount: 1, latestEndMin: 30 } as const;

export function computeSetExtremes(statsList: ScheduleStats[]): SetExtremes | null {
  if (statsList.length === 0) return null;
  const axis = (pick: (s: ScheduleStats) => number) => {
    const vs = statsList.map(pick);
    return { min: Math.min(...vs), max: Math.max(...vs) };
  };
  return {
    gapsMin: axis((s) => s.gapsMin),
    usedDaysCount: axis((s) => s.usedDaysCount),
    // -1 means "no meetings at all"; it would otherwise masquerade as the
    // earliest possible finish and win the good chip.
    latestEndMin: axis((s) => (s.latestEndMin >= 0 ? s.latestEndMin : 0)),
  };
}

/**
 * Why this option stands out against the others returned with it.
 *
 * Answers the question the score alone does not: given five schedules that all
 * satisfy the constraints, what is this one actually trading away? It needs no
 * preferences to be set, which is what makes it useful - the breakdown chips
 * only fire for soft preferences a student explicitly asked for, so by default
 * they are all empty.
 */
export function comparativeChips(stats: ScheduleStats, extremes: SetExtremes | null): ComparativeChip[] {
  if (!extremes) return [];
  const out: ComparativeChip[] = [];

  const consider = (
    key: keyof SetExtremes,
    value: number,
    lowLabel: string,
    highLabel: string,
    lowIsGood = true,
  ) => {
    const { min, max } = extremes[key];
    if (max - min < SPREAD_FLOOR[key]) return; // the set is much of a muchness here
    if (value === min) out.push({ tone: lowIsGood ? "good" : "bad", label: lowLabel });
    else if (value === max) out.push({ tone: lowIsGood ? "bad" : "good", label: highLabel });
  };

  consider("gapsMin", stats.gapsMin, "Fewest gaps", "Most gaps");
  consider("usedDaysCount", stats.usedDaysCount, "Fewest days on campus", "Most days on campus");
  consider("latestEndMin", stats.latestEndMin >= 0 ? stats.latestEndMin : 0, "Earliest finish", "Latest finish");

  return out;
}
