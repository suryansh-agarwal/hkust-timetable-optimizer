"use client";

import { useState } from "react";
import type { DayPref } from "./DayTimePrefs";

/**
 * The preference domain: the constants the controls offer, the validation
 * runOptimize runs, and the state itself.
 *
 * page.tsx still owns this state - it is called from there and feeds the
 * /optimize/ranked payload. It is grouped into hooks so PreferencesPanel
 * takes three props instead of twenty.
 */

export const DAYS = ["Mo", "Tu", "We", "Th", "Fr"] as const;

export type WeightPreset = "Low" | "Med" | "High";
export type GapShape = "no_preference" | "consolidated" | "fragmented";

export const GAP_WEIGHTS: Record<WeightPreset, number> = { Low: 0.05, Med: 0.10, High: 0.20 };
export const EARLY_LATE_WEIGHTS: Record<WeightPreset, number> = { Low: 0.25, Med: 0.50, High: 1.00 };

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
export function validateTimeConstraints(
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

export const NO_AFTER_TIMES = genNoAfterTimes();
export const NO_BEFORE_TIMES = genNoBeforeTimes();

export type DayPrefs = {
  freeDays: string[];
  setFreeDays: (days: string[]) => void;
  noAfter: Record<string, DayPref>;
  setNoAfter: (next: Record<string, DayPref>) => void;
  noBefore: Record<string, DayPref>;
  setNoBefore: (next: Record<string, DayPref>) => void;
};

/**
 * One set of day preferences - hard or soft. Called twice from page.tsx.
 * The defaults reproduce the four useState initialisers this replaced:
 * every day disabled, no-after at 15:00, no-before at 09:00.
 */
export function useDayPrefs(): DayPrefs {
  const [freeDays, setFreeDays] = useState<string[]>([]);
  const [noAfter, setNoAfter] = useState<Record<string, DayPref>>(() => {
    const init: Record<string, DayPref> = {};
    for (const d of DAYS) init[d] = { enabled: false, time: "15:00" };
    return init;
  });
  const [noBefore, setNoBefore] = useState<Record<string, DayPref>>(() => {
    const init: Record<string, DayPref> = {};
    for (const d of DAYS) init[d] = { enabled: false, time: "09:00" };
    return init;
  });
  return { freeDays, setFreeDays, noAfter, setNoAfter, noBefore, setNoBefore };
}

export type WeightPrefs = {
  gapWeightPreset: WeightPreset;
  setGapWeightPreset: (v: WeightPreset) => void;
  earlyLateWeightPreset: WeightPreset;
  setEarlyLateWeightPreset: (v: WeightPreset) => void;
  preferOneFreeDay: boolean;
  setPreferOneFreeDay: (v: boolean) => void;
  gapShape: GapShape;
  setGapShape: (v: GapShape) => void;
};

export function useWeightPrefs(): WeightPrefs {
  const [gapWeightPreset, setGapWeightPreset] = useState<WeightPreset>("Med");
  const [earlyLateWeightPreset, setEarlyLateWeightPreset] = useState<WeightPreset>("Med");
  const [preferOneFreeDay, setPreferOneFreeDay] = useState(true);
  const [gapShape, setGapShape] = useState<GapShape>("no_preference");
  return {
    gapWeightPreset, setGapWeightPreset,
    earlyLateWeightPreset, setEarlyLateWeightPreset,
    preferOneFreeDay, setPreferOneFreeDay,
    gapShape, setGapShape,
  };
}
