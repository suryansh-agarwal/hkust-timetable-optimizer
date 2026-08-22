"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type Meeting = {
  day: string;          // "Mo", "Tu", ...
  start_min: number;    // minutes since midnight
  end_min: number;
  course_code: string;
  section: string;
};

type MeetingWithSide = Meeting & { side: "A" | "B" };

const DAYS: { key: string; label: string }[] = [
  { key: "Mo", label: "Mon" },
  { key: "Tu", label: "Tue" },
  { key: "We", label: "Wed" },
  { key: "Th", label: "Thu" },
  { key: "Fr", label: "Fri" },
];

const DAY_LABELS: Record<string, string> = Object.fromEntries(DAYS.map((d) => [d.key, d.label]));

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function minutesToHHMM(m: number) {
  const hh = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function getSubjectFromCode(courseCode: string) {
  const matcher = /^[A-Z]+/;
  const match = matcher.exec(courseCode.trim().toUpperCase());
  return match ? match[0] : courseCode.trim().toUpperCase();
}

/**
 * Each subject gets one hue, defined in globals.css. Fill, border and label are
 * all derived from it, so dark mode only has to lighten the hue rather than
 * restate three colours per subject.
 */
function blockColors(hueVar: string) {
  return {
    bg: `hsl(var(${hueVar}) / 0.16)`,
    border: `hsl(var(${hueVar}) / 0.55)`,
    ink: `color-mix(in oklab, hsl(var(${hueVar})), black var(--sub-ink-mix))`,
  };
}

const SUBJECT_COLORS = [
  "--sub-1",
  "--sub-2",
  "--sub-3",
  "--sub-4",
  "--sub-5",
  "--sub-6",
  "--sub-7",
  "--sub-8",
].map(blockColors);

// simple overlap "lane" assignment per day
function assignLanes<T extends Meeting>(meetings: T[]): { placed: (T & { lane: number })[]; laneCount: number } {
  const sorted = [...meetings].sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min);
  const lanes: T[][] = [];

  const placed = sorted.map((m) => {
    // try place into existing lane
    for (let i = 0; i < lanes.length; i++) {
      const last = lanes[i][lanes[i].length - 1];
      if (last.end_min <= m.start_min) {
        lanes[i].push(m);
        return { ...m, lane: i };
      }
    }
    // else new lane
    lanes.push([m]);
    return { ...m, lane: lanes.length - 1 };
  });

  return { placed, laneCount: lanes.length };
}

const GRID_START_HOUR = 8;
const GRID_END_HOUR = 20;
const HOUR_ROW_HEIGHT = 64; // px per hour

function useGridGeometry(startHour = GRID_START_HOUR, endHour = GRID_END_HOUR) {
  const startMin = startHour * 60;
  const endMin = endHour * 60;
  const pxPerMin = HOUR_ROW_HEIGHT / 60;
  return { startHour, endHour, startMin, endMin, pxPerMin, gridHeight: (endMin - startMin) * pxPerMin };
}

function GridFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {children}
    </div>
  );
}

function GridHeaderRow() {
  return (
    <div className="grid grid-cols-[80px_repeat(5,1fr)] bg-muted border-b border-border">
      <div className="p-2.5 font-bold text-xs text-muted-foreground">Time</div>
      {DAYS.map((d) => (
        <div key={d.key} className="p-2.5 font-bold">{d.label}</div>
      ))}
    </div>
  );
}

function TimeAxis({ startHour, endHour, startMin, pxPerMin, gridHeight }: ReturnType<typeof useGridGeometry>) {
  return (
    <div className="relative border-r border-border" style={{ height: gridHeight }}>
      {Array.from({ length: endHour - startHour + 1 }).map((_, i) => {
        const hour = startHour + i;
        const y = (hour * 60 - startMin) * pxPerMin;
        return (
          <div key={hour} className="absolute text-xs text-muted-foreground" style={{ top: y - 8, left: 10 }}>
            {hour.toString().padStart(2, "0")}:00
          </div>
        );
      })}
    </div>
  );
}

function DayColumn({ dayKey, startHour, endHour, pxPerMin, gridHeight, children }: {
  dayKey: string;
  startHour: number;
  endHour: number;
  pxPerMin: number;
  gridHeight: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("relative", dayKey !== "Fr" && "border-r border-border")}
      style={{ height: gridHeight }}
    >
      {Array.from({ length: endHour - startHour }).map((_, i) => (
        <div key={i} className="absolute bg-border" style={{ top: i * 60 * pxPerMin, left: 0, right: 0, height: 1 }} />
      ))}
      {children}
    </div>
  );
}

// The row below the header that lays out the time axis and day columns in
// the same 80px + 5 equal columns template GridHeaderRow uses.
function GridBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_repeat(5,1fr)]">
      {children}
    </div>
  );
}

/**
 * Blocks are sized by duration, so a 30-minute class gets 32px and cannot
 * show three lines. Drop detail as height shrinks rather than shrinking the
 * type - the full string is on the block's aria-label and title regardless.
 *
 * Thresholds come from the content budget, not guesswork. With `p-1.5`
 * (12px vertical padding), a 2px border on each side (4px total) and
 * leading-tight: one `text-xs` line needs >= 31px, two lines need >= 46px,
 * and three lines (the third adds `mt-1` + `text-[11px]`) need >= 63.75px.
 * Rounded up to 64 / 46 so the boundary duration clears its budget rather
 * than landing exactly on it.
 */
function blockDetail(height: number): "full" | "code-and-section" | "code-only" {
  if (height >= 64) return "full";
  if (height >= 46) return "code-and-section";
  return "code-only";
}

export function TimetableGrid(props: {
  meetings: Meeting[];
  startHour?: number; // default 8
  endHour?: number;   // default 20
}) {
  const { startHour, endHour, startMin, endMin, pxPerMin, gridHeight } = useGridGeometry(props.startHour, props.endHour);

  const byDay = useMemo(() => {
    const map: Record<string, Meeting[]> = {};
    for (const d of DAYS) map[d.key] = [];
    for (const m of props.meetings) {
      if (!map[m.day]) continue;
      // clip into visible window
      const clipped: Meeting = {
        ...m,
        start_min: clamp(m.start_min, startMin, endMin),
        end_min: clamp(m.end_min, startMin, endMin),
      };
      if (clipped.end_min > clipped.start_min) map[m.day].push(clipped);
    }
    return map;
  }, [props.meetings, startMin, endMin]);

  // lane packing per day
  const packed = useMemo(() => {
    const out: Record<string, { placed: (Meeting & { lane: number })[]; laneCount: number }> = {};
    for (const d of DAYS) {
      out[d.key] = assignLanes(byDay[d.key] ?? []);
    }
    return out;
  }, [byDay]);

  const subjectColors = useMemo(() => {
    const subjects = Array.from(
      new Set(props.meetings.map((m) => getSubjectFromCode(m.course_code)))
    ).sort((a, b) => a.localeCompare(b));
    const map = new Map<string, { bg: string; border: string; ink: string }>();
    subjects.forEach((subject, idx) => {
      map.set(subject, SUBJECT_COLORS[idx % SUBJECT_COLORS.length]);
    });
    return map;
  }, [props.meetings]);

  return (
    <GridFrame>
      <GridHeaderRow />

      <GridBody>
        <TimeAxis startHour={startHour} endHour={endHour} startMin={startMin} endMin={endMin} pxPerMin={pxPerMin} gridHeight={gridHeight} />

        {/* day columns */}
        {DAYS.map((d) => {
          const { placed, laneCount } = packed[d.key];
          return (
            <DayColumn key={d.key} dayKey={d.key} startHour={startHour} endHour={endHour} pxPerMin={pxPerMin} gridHeight={gridHeight}>
              {/* blocks */}
              {placed.map((m, idx) => {
                const top = (m.start_min - startMin) * pxPerMin;
                const height = Math.max(22, (m.end_min - m.start_min) * pxPerMin);

                // lane width (avoid division by 0)
                const lanes = Math.max(1, laneCount);
                const gap = 6;
                const laneWidthPct = 100 / lanes;
                const leftPct = m.lane * laneWidthPct;

                const subject = getSubjectFromCode(m.course_code);
                const colors = subjectColors.get(subject) ?? SUBJECT_COLORS[0];

                const label = `${m.course_code} ${m.section}, ${DAY_LABELS[m.day] ?? m.day} ${minutesToHHMM(m.start_min)} to ${minutesToHHMM(m.end_min)}`;
                const detail = blockDetail(height);

                return (
                  <div
                    key={idx}
                    data-slot="grid-block"
                    tabIndex={0}
                    aria-label={label}
                    title={label}
                    className={cn(
                      "shadow-sm transition-shadow duration-150 hover:shadow-md",
                      detail === "code-only" ? "px-1.5 py-px" : "p-1.5"
                    )}
                    style={{
                      position: "absolute",
                      top,
                      height,
                      left: `calc(${leftPct}% + ${gap / 2}px)`,
                      width: `calc(${laneWidthPct}% - ${gap}px)`,
                      borderRadius: 10,
                      border: `2px solid ${colors.border}`,
                      fontSize: 12,
                      background: colors.bg,
                      overflow: "hidden",
                    }}
                  >
                    <div className="text-xs font-bold leading-tight" style={{ color: colors.ink }}>{m.course_code}</div>
                    {detail !== "code-only" && (
                      <div className="text-xs leading-tight" style={{ color: colors.ink }}>{m.section}</div>
                    )}
                    {detail === "full" && (
                      <div className="mt-1 text-[11px] leading-tight" style={{ color: colors.ink }}>
                        {minutesToHHMM(m.start_min)}–{minutesToHHMM(m.end_min)}
                      </div>
                    )}
                  </div>
                );
              })}
            </DayColumn>
          );
        })}
      </GridBody>
    </GridFrame>
  );
}

// ---- Compare Timetable Grid with overlay and hover-to-fade ----
export function CompareTimetableGrid(props: {
  meetingsA: Meeting[];
  meetingsB: Meeting[];
  startHour?: number;
  endHour?: number;
}) {
  const { startHour, endHour, startMin, endMin, pxPerMin, gridHeight } = useGridGeometry(props.startHour, props.endHour);

  // Track which side is being hovered (null = show both)
  const [hoveredSide, setHoveredSide] = useState<"A" | "B" | null>(null);

  // Merge both meeting lists with side tags
  const allMeetings: MeetingWithSide[] = useMemo(() => {
    const a = props.meetingsA.map((m) => ({ ...m, side: "A" as const }));
    const b = props.meetingsB.map((m) => ({ ...m, side: "B" as const }));
    return [...a, ...b];
  }, [props.meetingsA, props.meetingsB]);

  // Group by day and clip
  const byDay = useMemo(() => {
    const map: Record<string, MeetingWithSide[]> = {};
    for (const d of DAYS) map[d.key] = [];
    for (const m of allMeetings) {
      if (!map[m.day]) continue;
      const clipped: MeetingWithSide = {
        ...m,
        start_min: clamp(m.start_min, startMin, endMin),
        end_min: clamp(m.end_min, startMin, endMin),
      };
      if (clipped.end_min > clipped.start_min) map[m.day].push(clipped);
    }
    return map;
  }, [allMeetings, startMin, endMin]);

  // Lane packing per day
  const packed = useMemo(() => {
    const out: Record<string, { placed: (MeetingWithSide & { lane: number })[]; laneCount: number }> = {};
    for (const d of DAYS) {
      out[d.key] = assignLanes(byDay[d.key] ?? []);
    }
    return out;
  }, [byDay]);

  // Color schemes
  const colorA = blockColors("--cmp-a");
  const colorB = blockColors("--cmp-b");

  return (
    <GridFrame>
      <GridHeaderRow />

      <GridBody>
        <TimeAxis startHour={startHour} endHour={endHour} startMin={startMin} endMin={endMin} pxPerMin={pxPerMin} gridHeight={gridHeight} />

        {/* day columns */}
        {DAYS.map((d) => {
          const { placed, laneCount } = packed[d.key];
          return (
            <DayColumn key={d.key} dayKey={d.key} startHour={startHour} endHour={endHour} pxPerMin={pxPerMin} gridHeight={gridHeight}>
              {/* blocks */}
              {placed.map((m, idx) => {
                const top = (m.start_min - startMin) * pxPerMin;
                const height = Math.max(22, (m.end_min - m.start_min) * pxPerMin);

                const lanes = Math.max(1, laneCount);
                const gap = 6;
                const laneWidthPct = 100 / lanes;
                const leftPct = m.lane * laneWidthPct;

                const colors = m.side === "A" ? colorA : colorB;

                // Determine opacity based on hover/focus state
                const isDimmedByHover = hoveredSide !== null && hoveredSide !== m.side;
                const opacity = isDimmedByHover ? 0.25 : 1;

                const label = `Option ${m.side}, ${m.course_code} ${m.section}, ${DAY_LABELS[m.day] ?? m.day} ${minutesToHHMM(m.start_min)} to ${minutesToHHMM(m.end_min)}`;
                const detail = blockDetail(height);

                return (
                  <div
                    key={`${m.side}-${idx}`}
                    data-slot="grid-block"
                    tabIndex={0}
                    aria-label={label}
                    title={label}
                    className={cn(
                      "shadow-sm transition-[opacity,box-shadow] duration-150 ease-in-out hover:shadow-md",
                      detail === "code-only" ? "px-1.5 py-px" : "p-1.5"
                    )}
                    onMouseEnter={() => setHoveredSide(m.side)}
                    onMouseLeave={() => setHoveredSide(null)}
                    onFocus={() => setHoveredSide(m.side)}
                    onBlur={() => setHoveredSide(null)}
                    style={{
                      position: "absolute",
                      top,
                      height,
                      left: `calc(${leftPct}% + ${gap / 2}px)`,
                      width: `calc(${laneWidthPct}% - ${gap}px)`,
                      borderRadius: 10,
                      border: `2px solid ${colors.border}`,
                      fontSize: 12,
                      background: colors.bg,
                      overflow: "hidden",
                      opacity,
                      zIndex: hoveredSide === m.side ? 10 : 1,
                    }}
                  >
                    <div className="text-xs font-bold leading-tight" style={{ color: colors.ink }}>{m.course_code}</div>
                    {detail !== "code-only" && (
                      <div className="text-xs leading-tight" style={{ color: colors.ink }}>{m.section}</div>
                    )}
                    {detail === "full" && (
                      <div className="mt-1 text-[11px] leading-tight" style={{ color: colors.ink }}>
                        {minutesToHHMM(m.start_min)}–{minutesToHHMM(m.end_min)}
                      </div>
                    )}
                  </div>
                );
              })}
            </DayColumn>
          );
        })}
      </GridBody>
    </GridFrame>
  );
}
