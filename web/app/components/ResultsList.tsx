"use client";

import { useMemo } from "react";
import { TimetableGrid } from "./TimetableGrid";
import { ResultCard, type OptimizerResult } from "./ResultCard";
import { flattenSchedule, penaltyLabel, bonusLabel, type Bonus, type Penalty } from "@/lib/schedule";

export function ResultsList({
  results,
  considered,
  returned,
  activeIdx,
  onSelectIdx,
  isPinned,
  onPin,
}: Readonly<{
  results: OptimizerResult[];
  considered: number;
  returned: number;
  activeIdx: number;
  onSelectIdx: (i: number) => void;
  isPinned: (i: number) => boolean;
  onPin: (r: OptimizerResult, i: number) => void;
}>) {
  const active = results[activeIdx];
  const meetings = useMemo(() => (active ? flattenSchedule(active.schedule) : []), [active]);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700 }}>Results</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            considered {considered}, returned {returned}
          </div>
        </div>
      </div>

      {/* Schedule cards */}
      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {results.map((r, i: number) => (
          <ResultCard
            key={i}
            result={r}
            index={i}
            isActive={i === activeIdx}
            isPinned={isPinned(i)}
            onSelect={() => onSelectIdx(i)}
            onPin={() => onPin(r, i)}
          />
        ))}
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
    </>
  );
}
