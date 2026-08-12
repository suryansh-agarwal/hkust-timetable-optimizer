"use client";

import { Button } from "@/components/ui/button";
import {
  bonusLabel, computeStatsFromMeetings, flattenSchedule, formatDayList, minutesToTime, penaltyLabel,
  type Bonus, type Penalty,
} from "@/lib/schedule";

export type OptimizerResult = {
  score: number;
  breakdown: { penalties?: unknown[]; bonuses?: unknown[] };
  schedule: unknown[];
};

export function ResultCard({
  result,
  index,
  isActive,
  isPinned,
  onSelect,
  onPin,
}: Readonly<{
  result: OptimizerResult;
  index: number;
  isActive: boolean;
  isPinned: boolean;
  onSelect: () => void;
  onPin: () => void;
}>) {
  const ms = flattenSchedule(result.schedule);
  const stats = computeStatsFromMeetings(ms);

  // The gaps penalty and the free-days bonus are already stated exactly
  // above as "Gaps: N min" and "Free days: N (...)", so as chips they only
  // repeat the numbers in a noisier form.
  const penalties = ((result.breakdown?.penalties ?? []) as Penalty[]).filter((p) => p.type !== "gaps_minutes");
  const bonuses = ((result.breakdown?.bonuses ?? []) as Bonus[]).filter((b) => b.type !== "free_days");

  return (
    <div
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
      onClick={() => onSelect()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(); }}
      role="button"
      tabIndex={0}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>Option #{index + 1}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Score {result.score.toFixed(1)}</div>
          <Button
            variant={isPinned ? "default" : "outline"}
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onPin();
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
}
