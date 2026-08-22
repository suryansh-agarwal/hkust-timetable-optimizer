import { describe, expect, it } from "vitest";
import {
  computeSetExtremes,
  comparativeChips,
  computeStatsFromMeetings,
  flattenSchedule,
  formatDayList,
  minutesToTime,
  penaltyLabel,
  bonusLabel,
  type Meeting,
} from "./schedule";

const mtg = (day: string, start_min: number, end_min: number, course_code = "COMP 1021", section = "L1"): Meeting =>
  ({ day, start_min, end_min, course_code, section });

describe("flattenSchedule", () => {
  it("flattens every meeting of every part, carrying the course code and section down", () => {
    const schedule = [
      { course_code: "MATH 1003", parts: [
        { section: "L1", meetings: [{ day: "Mo", start_min: 540, end_min: 620 }, { day: "We", start_min: 540, end_min: 620 }] },
        { section: "T1A", meetings: [{ day: "Fr", start_min: 660, end_min: 710 }] },
      ] },
    ];
    expect(flattenSchedule(schedule)).toEqual([
      { day: "Mo", start_min: 540, end_min: 620, course_code: "MATH 1003", section: "L1" },
      { day: "We", start_min: 540, end_min: 620, course_code: "MATH 1003", section: "L1" },
      { day: "Fr", start_min: 660, end_min: 710, course_code: "MATH 1003", section: "T1A" },
    ]);
  });

  it("returns an empty array for an empty schedule", () => {
    expect(flattenSchedule([])).toEqual([]);
  });
});

describe("computeStatsFromMeetings", () => {
  it("counts used and free weekdays", () => {
    const s = computeStatsFromMeetings([mtg("Mo", 540, 620), mtg("We", 540, 620)]);
    expect(s.usedDaysCount).toBe(2);
    expect(s.freeDaysCount).toBe(3);
    expect(s.freeDays).toEqual(["Tu", "Th", "Fr"]);
  });

  it("reports the latest end together with the day it falls on", () => {
    const s = computeStatsFromMeetings([mtg("Mo", 540, 620), mtg("Th", 1020, 1130)]);
    expect(s.latestEndMin).toBe(1130);
    expect(s.latestEndDay).toBe("Th");
  });

  it("sums gaps between consecutive classes on the same day, ignoring back-to-back", () => {
    const s = computeStatsFromMeetings([
      mtg("Mo", 540, 600),
      mtg("Mo", 660, 720), // 60 min gap
      mtg("Mo", 720, 780), // back to back, no gap
    ]);
    expect(s.gapsMin).toBe(60);
  });

  it("does not count time between classes on different days as a gap", () => {
    const s = computeStatsFromMeetings([mtg("Mo", 540, 600), mtg("Tu", 900, 960)]);
    expect(s.gapsMin).toBe(0);
  });

  it("sums gaps across several days", () => {
    const s = computeStatsFromMeetings([
      mtg("Mo", 540, 600), mtg("Mo", 630, 690), // 30
      mtg("We", 540, 600), mtg("We", 660, 720), // 60
    ]);
    expect(s.gapsMin).toBe(90);
  });

  it("orders a day's classes before measuring, so input order does not matter", () => {
    const late = computeStatsFromMeetings([mtg("Mo", 660, 720), mtg("Mo", 540, 600)]);
    expect(late.gapsMin).toBe(60);
  });

  it("reports the earliest start, and null when there are no meetings", () => {
    expect(computeStatsFromMeetings([mtg("Mo", 540, 600), mtg("Tu", 480, 540)]).earliestStartMin).toBe(480);
    expect(computeStatsFromMeetings([]).earliestStartMin).toBeNull();
  });

  it("returns five free days and no latest-end day for an empty schedule", () => {
    const s = computeStatsFromMeetings([]);
    expect(s.freeDaysCount).toBe(5);
    expect(s.latestEndDay).toBeNull();
    expect(s.latestEndMin).toBe(-1);
  });

  it("ignores meetings on days outside Mo-Fr", () => {
    const s = computeStatsFromMeetings([mtg("Sa", 540, 600)]);
    expect(s.usedDaysCount).toBe(0);
    expect(s.freeDaysCount).toBe(5);
  });
});

describe("minutesToTime", () => {
  it("zero-pads both halves", () => {
    expect(minutesToTime(540)).toBe("09:00");
    expect(minutesToTime(605)).toBe("10:05");
    expect(minutesToTime(0)).toBe("00:00");
  });
});

describe("formatDayList", () => {
  it("joins with a comma and space", () => {
    expect(formatDayList(["Mo", "We"])).toBe("Mo, We");
  });

  it("says (none) for an empty list", () => {
    expect(formatDayList([])).toBe("(none)");
  });
});

describe("penaltyLabel", () => {
  it("labels each type scoring.py can emit", () => {
    expect(penaltyLabel({ type: "soft_no_after", day: "Mo", cutoff: "17:00" })).toBe("After cutoff (Mo 17:00)");
    expect(penaltyLabel({ type: "soft_no_before", day: "Tu", cutoff: "09:00" })).toBe("Before cutoff (Tu 09:00)");
    expect(penaltyLabel({ type: "soft_free_day", day: "Fr" })).toBe("Fr not free");
  });

  it("falls through to the raw type name for anything unlabelled", () => {
    expect(penaltyLabel({ type: "some_future_penalty" })).toBe("some_future_penalty");
  });

  it("formats gaps_minutes with no shape suffix when shape is absent", () => {
    expect(penaltyLabel({ type: "gaps_minutes", minutes: 45 })).toBe("Gaps (45 min)");
  });

  it("rounds gaps_minutes to one decimal place", () => {
    expect(penaltyLabel({ type: "gaps_minutes", minutes: 12.345 })).toBe("Gaps (12.3 min)");
  });

  it("appends ', prefer 1 long' for a consolidated gap shape", () => {
    expect(penaltyLabel({ type: "gaps_minutes", minutes: 30, shape: "consolidated" })).toBe("Gaps (30 min, prefer 1 long)");
  });

  it("appends ', prefer short' for a fragmented gap shape", () => {
    expect(penaltyLabel({ type: "gaps_minutes", minutes: 30, shape: "fragmented" })).toBe("Gaps (30 min, prefer short)");
  });

  it("treats a missing minutes value as 0", () => {
    expect(penaltyLabel({ type: "gaps_minutes" })).toBe("Gaps (0 min)");
  });

  it("labels a hard free day violation", () => {
    expect(penaltyLabel({ type: "hard_free_day_violation", day: "We" })).toBe("Hard free day violated (We)");
  });
});

describe("bonusLabel", () => {
  it("labels free_days with its value", () => {
    expect(bonusLabel({ type: "free_days", value: 2 })).toBe("Free days (+2)");
  });

  it("labels soft_free_day with the day it's free on", () => {
    expect(bonusLabel({ type: "soft_free_day", day: "Fr" })).toBe("Fr free");
  });

  it("falls through to the raw type name for anything unlabelled", () => {
    expect(bonusLabel({ type: "some_future_bonus" })).toBe("some_future_bonus");
  });
});

describe("computeSetExtremes / comparativeChips", () => {
  const statsFor = (meetings: Meeting[]) => computeStatsFromMeetings(meetings);

  // three options that differ on every axis by more than the floor
  const tight = statsFor([mtg("Mo", 540, 600), mtg("Mo", 600, 660)]);                 // 0 gap, 1 day, ends 660
  const loose = statsFor([mtg("Mo", 540, 600), mtg("Mo", 780, 840)]);                 // 180 gap, 1 day, ends 840
  const spread = statsFor([mtg("Mo", 540, 600), mtg("Tu", 540, 600), mtg("We", 540, 600)]); // 0 gap, 3 days, ends 600

  const extremes = computeSetExtremes([tight, loose, spread]);

  it("returns null for an empty set rather than Infinity extremes", () => {
    expect(computeSetExtremes([])).toBeNull();
  });

  it("labels the option at each end of an axis", () => {
    expect(comparativeChips(loose, extremes)).toContainEqual({ tone: "bad", label: "Most gaps" });
    expect(comparativeChips(loose, extremes)).toContainEqual({ tone: "bad", label: "Latest finish" });
    expect(comparativeChips(spread, extremes)).toContainEqual({ tone: "bad", label: "Most days on campus" });
    expect(comparativeChips(spread, extremes)).toContainEqual({ tone: "good", label: "Earliest finish" });
  });

  it("stays silent on an axis whose spread is below the floor", () => {
    // both end within 10 minutes and use one day - only gaps should speak
    const a = statsFor([mtg("Mo", 540, 600), mtg("Mo", 600, 660)]);
    const b = statsFor([mtg("Mo", 540, 600), mtg("Mo", 780, 670 + 200)]);
    const e = computeSetExtremes([a, b])!;
    const labels = [...comparativeChips(a, e), ...comparativeChips(b, e)].map((c) => c.label);
    expect(labels).not.toContain("Fewest days on campus");
    expect(labels).not.toContain("Most days on campus");
  });

  it("says nothing at all when every option is identical", () => {
    const same = statsFor([mtg("Mo", 540, 600)]);
    const e = computeSetExtremes([same, same, same])!;
    expect(comparativeChips(same, e)).toEqual([]);
  });

  it("gives every tied option the same chip rather than picking one arbitrarily", () => {
    const a = statsFor([mtg("Mo", 540, 600), mtg("Mo", 600, 660)]);   // 0 gap
    const b = statsFor([mtg("Tu", 540, 600), mtg("Tu", 600, 660)]);   // 0 gap, ties a
    const c = statsFor([mtg("We", 540, 600), mtg("We", 780, 840)]);   // 180 gap
    const e = computeSetExtremes([a, b, c])!;
    expect(comparativeChips(a, e)).toContainEqual({ tone: "good", label: "Fewest gaps" });
    expect(comparativeChips(b, e)).toContainEqual({ tone: "good", label: "Fewest gaps" });
  });

  it("normalises an empty schedule's -1 sentinel so the extremes never go negative", () => {
    const empty = statsFor([]);
    const real = statsFor([mtg("Mo", 540, 600)]);
    const e = computeSetExtremes([empty, real])!;
    // -1 means "no meetings", not "finished before midnight" - left raw it
    // would drag the axis minimum below zero and widen every spread by one.
    expect(e.latestEndMin.min).toBe(0);
    expect(e.latestEndMin.max).toBe(600);
  });
});
