"use client";

import { useMemo } from "react";
import { TimetableGrid, GRID_MIN_WIDTH_PX } from "./TimetableGrid";
import { ResultCard, type OptimizerResult } from "./ResultCard";
import { Badge } from "@/components/ui/badge";
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

  // The best score is a property of the set, not of any one card, so it is
  // computed once here and passed down - ResultCard has no business reaching
  // for its siblings to find out where it stands.
  const bestScore = results.length > 0 ? Math.max(...results.map((r) => r.score)) : 0;
  const worstScore = results.length > 0 ? Math.min(...results.map((r) => r.score)) : 0;

  return (
    <>
      <div>
        <h2 className="text-lg font-semibold">Results</h2>
        <div className="mt-1 text-sm text-muted-foreground">
          considered {considered}, returned {returned}
        </div>
      </div>

      {/* Schedule cards */}
      <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
        {results.map((r, i: number) => (
          <ResultCard
            key={i}
            result={r}
            index={i}
            bestScore={bestScore}
            worstScore={worstScore}
            isActive={i === activeIdx}
            isPinned={isPinned(i)}
            onSelect={() => onSelectIdx(i)}
            onPin={() => onPin(r, i)}
          />
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <div className="text-sm font-semibold">Score: {active?.score.toFixed(1)}</div>
        <div className="flex flex-wrap gap-2">
          {/* Same two omissions as the cards above: the gaps penalty and
              the free-days bonus are already stated per option, so
              repeating them here adds nothing. */}
          {(active?.breakdown?.penalties as Penalty[] | undefined)
            ?.filter((p) => p.type !== "gaps_minutes")
            .map((p, idx: number) => (
              <Badge
                key={idx}
                variant="outline"
                className="border-[var(--danger-border)] bg-[var(--danger-chip-bg)] text-[var(--danger)]"
              >
                ❌ {penaltyLabel(p)}
              </Badge>
            ))}
          {(active?.breakdown?.bonuses as Bonus[] | undefined)
            ?.filter((b) => b.type !== "free_days")
            .map((b, idx: number) => (
              <Badge key={idx} variant="secondary">✅ {bonusLabel(b)}</Badge>
            ))}
        </div>
      </div>

      {/* simple per-day list view (Stage 6 can be a real grid) */}
      <div className="mt-6">
        <div className="overflow-x-auto">
          <div style={{ minWidth: GRID_MIN_WIDTH_PX }}>
            <TimetableGrid meetings={meetings} startHour={8} endHour={20} />
          </div>
        </div>
      </div>
    </>
  );
}
