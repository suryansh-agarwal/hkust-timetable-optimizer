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
