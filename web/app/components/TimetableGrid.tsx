"use client";

import React, { useMemo, useState } from "react";

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

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function minutesToHHMM(m: number) {
  const hh = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

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

export function TimetableGrid(props: {
  meetings: Meeting[];
  startHour?: number; // default 8
  endHour?: number;   // default 20
}) {
  const startHour = props.startHour ?? 8;
  const endHour = props.endHour ?? 20;

  const startMin = startHour * 60;
  const endMin = endHour * 60;
  const totalMin = endMin - startMin;

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

  // layout constants
  const hourRowHeight = 64; // px per hour
  const pxPerMin = hourRowHeight / 60;
  const gridHeight = totalMin * pxPerMin;

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
      {/* header */}
      <div style={{ display: "grid", gridTemplateColumns: `80px repeat(5, 1fr)`, background: "#fafafa", borderBottom: "1px solid #eee" }}>
        <div style={{ padding: 10, fontWeight: 700, fontSize: 12, color: "#666" }}>Time</div>
        {DAYS.map((d) => (
          <div key={d.key} style={{ padding: 10, fontWeight: 700 }}>{d.label}</div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `80px repeat(5, 1fr)` }}>
        {/* time axis */}
        <div style={{ position: "relative", height: gridHeight, borderRight: "1px solid #eee" }}>
          {Array.from({ length: endHour - startHour + 1 }).map((_, i) => {
            const hour = startHour + i;
            const y = (hour * 60 - startMin) * pxPerMin;
            return (
              <div key={hour} style={{ position: "absolute", top: y - 8, left: 10, fontSize: 12, color: "#666" }}>
                {hour.toString().padStart(2, "0")}:00
              </div>
            );
          })}
        </div>

        {/* day columns */}
        {DAYS.map((d) => {
          const { placed, laneCount } = packed[d.key];
          return (
            <div key={d.key} style={{ position: "relative", height: gridHeight, borderRight: d.key !== "Fr" ? "1px solid #eee" : undefined }}>
              {/* hour lines */}
              {Array.from({ length: endHour - startHour }).map((_, i) => {
                const y = (i * 60) * pxPerMin;
                return <div key={i} style={{ position: "absolute", top: y, left: 0, right: 0, height: 1, background: "#f1f1f1" }} />;
              })}

              {/* blocks */}
              {placed.map((m, idx) => {
                const top = (m.start_min - startMin) * pxPerMin;
                const height = Math.max(22, (m.end_min - m.start_min) * pxPerMin);

                // lane width (avoid division by 0)
                const lanes = Math.max(1, laneCount);
                const gap = 6;
                const laneWidthPct = 100 / lanes;
                const leftPct = m.lane * laneWidthPct;

                return (
                  <div
                    key={idx}
                    title={`${m.course_code} ${m.section}\n${m.day} ${minutesToHHMM(m.start_min)}–${minutesToHHMM(m.end_min)}`}
                    style={{
                      position: "absolute",
                      top,
                      height,
                      left: `calc(${leftPct}% + ${gap / 2}px)`,
                      width: `calc(${laneWidthPct}% - ${gap}px)`,
                      borderRadius: 10,
                      border: "1px solid #e6e6e6",
                      padding: 8,
                      fontSize: 12,
                      background: "white",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 12 }}>{m.course_code}</div>
                    <div style={{ fontSize: 12, color: "#444" }}>{m.section}</div>
                    <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
                      {minutesToHHMM(m.start_min)}–{minutesToHHMM(m.end_min)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Compare Timetable Grid with overlay and hover-to-fade ----
export function CompareTimetableGrid(props: {
  meetingsA: Meeting[];
  meetingsB: Meeting[];
  startHour?: number;
  endHour?: number;
}) {
  const startHour = props.startHour ?? 8;
  const endHour = props.endHour ?? 20;

  const startMin = startHour * 60;
  const endMin = endHour * 60;
  const totalMin = endMin - startMin;

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

  const hourRowHeight = 64;
  const pxPerMin = hourRowHeight / 60;
  const gridHeight = totalMin * pxPerMin;

  // Color schemes
  const colorA = {
    bg: "rgba(239, 68, 68, 0.15)",
    border: "rgba(239, 68, 68, 0.4)",
    text: "#b91c1c",
  };
  const colorB = {
    bg: "rgba(59, 130, 246, 0.15)",
    border: "rgba(59, 130, 246, 0.4)",
    text: "#1d4ed8",
  };

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
      {/* header */}
      <div style={{ display: "grid", gridTemplateColumns: `80px repeat(5, 1fr)`, background: "#fafafa", borderBottom: "1px solid #eee" }}>
        <div style={{ padding: 10, fontWeight: 700, fontSize: 12, color: "#666" }}>Time</div>
        {DAYS.map((d) => (
          <div key={d.key} style={{ padding: 10, fontWeight: 700 }}>{d.label}</div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `80px repeat(5, 1fr)` }}>
        {/* time axis */}
        <div style={{ position: "relative", height: gridHeight, borderRight: "1px solid #eee" }}>
          {Array.from({ length: endHour - startHour + 1 }).map((_, i) => {
            const hour = startHour + i;
            const y = (hour * 60 - startMin) * pxPerMin;
            return (
              <div key={hour} style={{ position: "absolute", top: y - 8, left: 10, fontSize: 12, color: "#666" }}>
                {hour.toString().padStart(2, "0")}:00
              </div>
            );
          })}
        </div>

        {/* day columns */}
        {DAYS.map((d) => {
          const { placed, laneCount } = packed[d.key];
          return (
            <div key={d.key} style={{ position: "relative", height: gridHeight, borderRight: d.key !== "Fr" ? "1px solid #eee" : undefined }}>
              {/* hour lines */}
              {Array.from({ length: endHour - startHour }).map((_, i) => {
                const y = i * 60 * pxPerMin;
                return <div key={i} style={{ position: "absolute", top: y, left: 0, right: 0, height: 1, background: "#f1f1f1" }} />;
              })}

              {/* blocks */}
              {placed.map((m, idx) => {
                const top = (m.start_min - startMin) * pxPerMin;
                const height = Math.max(22, (m.end_min - m.start_min) * pxPerMin);

                const lanes = Math.max(1, laneCount);
                const gap = 6;
                const laneWidthPct = 100 / lanes;
                const leftPct = m.lane * laneWidthPct;

                const colors = m.side === "A" ? colorA : colorB;

                // Determine opacity based on hover state
                const isHiddenBecauseHover = hoveredSide !== null && hoveredSide !== m.side;
                const opacity = isHiddenBecauseHover ? 0.1 : 1;

                return (
                  <div
                    key={`${m.side}-${idx}`}
                    title={`[${m.side}] ${m.course_code} ${m.section}\n${m.day} ${minutesToHHMM(m.start_min)}–${minutesToHHMM(m.end_min)}`}
                    onMouseEnter={() => setHoveredSide(m.side)}
                    onMouseLeave={() => setHoveredSide(null)}
                    style={{
                      position: "absolute",
                      top,
                      height,
                      left: `calc(${leftPct}% + ${gap / 2}px)`,
                      width: `calc(${laneWidthPct}% - ${gap}px)`,
                      borderRadius: 10,
                      border: `2px solid ${colors.border}`,
                      padding: 8,
                      fontSize: 12,
                      background: colors.bg,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                      overflow: "hidden",
                      opacity,
                      transition: "opacity 0.15s ease-in-out",
                      cursor: "pointer",
                      zIndex: hoveredSide === m.side ? 10 : 1,
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 12, color: colors.text }}>{m.course_code}</div>
                    <div style={{ fontSize: 12, color: colors.text, opacity: 0.8 }}>{m.section}</div>
                    <div style={{ fontSize: 11, color: colors.text, opacity: 0.7, marginTop: 4 }}>
                      {minutesToHHMM(m.start_min)}–{minutesToHHMM(m.end_min)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
