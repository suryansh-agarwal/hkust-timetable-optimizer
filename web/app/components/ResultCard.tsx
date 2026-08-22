"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  bonusLabel, comparativeChips, formatDayList, minutesToTime, penaltyLabel,
  type Bonus, type Penalty, type ScheduleStats, type SetExtremes,
} from "@/lib/schedule";

export type OptimizerResult = {
  score: number;
  breakdown: { penalties?: unknown[]; bonuses?: unknown[] };
  schedule: unknown[];
};

/**
 * The narrowest score spread the bar will stretch across. Below this the set
 * is treated as "these are all much of a muchness" and the bars stay close,
 * rather than magnifying a rounding difference into a visual gulf.
 *
 * With no soft preferences set, the only live scoring term is
 * -gaps_minutes * 0.10, so 20 points is roughly 200 minutes of gap
 * difference between the best and worst option in the set.
 */
const MIN_SPAN = 20;

export function ResultCard({
  result,
  index,
  stats,
  extremes,
  bestScore,
  worstScore,
  isActive,
  isPinned,
  onSelect,
  onPin,
}: Readonly<{
  result: OptimizerResult;
  index: number;
  stats: ScheduleStats;
  extremes: SetExtremes | null;
  bestScore: number;
  worstScore: number;
  isActive: boolean;
  isPinned: boolean;
  onSelect: () => void;
  onPin: () => void;
}>) {

  // The gaps penalty and the free-days bonus are already stated exactly
  // above as "Gaps: N min" and "Free days: N (...)", so as chips they only
  // repeat the numbers in a noisier form.
  const penalties = ((result.breakdown?.penalties ?? []) as Penalty[]).filter((p) => p.type !== "gaps_minutes");
  const bonuses = ((result.breakdown?.bonuses ?? []) as Bonus[]).filter((b) => b.type !== "free_days");

  // Where this option stands against the others returned with it. The chips
  // above only fire for soft preferences a student explicitly set, so with
  // none set they are always empty and the card said nothing at all.
  // The chip row holds three at most; breakdown chips come first because they
  // answer a question the student actually asked, then comparatives fill the
  // remainder. Sliced once here so the row does not restate the limits.
  const shownPenalties = penalties.slice(0, 3);
  const shownBonuses = bonuses.slice(0, 2);
  const shownComparative = comparativeChips(stats, extremes)
    .slice(0, Math.max(0, 3 - shownPenalties.length - shownBonuses.length));
  const noChips = shownPenalties.length + shownBonuses.length + shownComparative.length === 0;

  // The bar measures how far this option falls behind the best one, against
  // the spread of the returned set - but with a floor under that spread.
  //
  // Plain range-normalisation (best = full, worst = empty) would inflate a
  // 1.0 difference into a full-width gap and tell a student two near-identical
  // schedules are far apart. MIN_SPAN stops that: while the whole set sits
  // within 20 points, the bars stay close together, which is the honest
  // picture. Once the set genuinely spreads wider, the bars spread with it.
  //
  // Dividing by bestScore instead does not work: scores are a base with
  // penalties subtracted, so they reach zero and go negative on constrained
  // searches. A real run returned 0.0/-1.0/-13.0/-16.0/-19.0/-25.0, where any
  // ratio against the best is meaningless.
  const span = Math.max(bestScore - worstScore, MIN_SPAN);
  // Floored at 2 so the worst option in a wide-spread set still renders a
  // visible sliver inside the overflow-hidden track, instead of a 0%-width
  // fill that reads as "nothing here" rather than "ranked last".
  const pct = Math.max(2, Math.min(100, 100 * (1 - (bestScore - result.score) / span)));
  const delta = result.score - bestScore;

  return (
    <Card
      size="sm"
      role="button"
      tabIndex={0}
      onClick={() => onSelect()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(); }}
      className={`cursor-pointer px-3 text-left ${
        isActive ? "ring-2 ring-[var(--active-border)] shadow-[var(--shadow-md)]" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Option #{index + 1}</div>
        <Button
          variant={isPinned ? "default" : "outline"}
          size="sm"
          className="min-h-11 lg:min-h-0"
          onClick={(e) => {
            e.stopPropagation();
            onPin();
          }}
          title={isPinned ? "Pinned" : "Pin this option for comparison"}
        >
          {isPinned ? "✅ Pinned" : "📌 Pin"}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
          {delta === 0 ? "best" : delta.toFixed(1)}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">Score {result.score.toFixed(1)}</div>

      <div className="flex flex-col gap-1 text-sm text-foreground">
        <div className="flex items-center justify-between">
          <span>Free days</span>
          <span className="font-semibold tabular-nums">
            {stats.freeDaysCount} ({formatDayList(stats.freeDays)})
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Days on campus</span>
          <span className="font-semibold tabular-nums">{stats.usedDaysCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Gaps</span>
          <span className="font-semibold tabular-nums">{stats.gapsMin} min</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Latest end</span>
          <span className="font-semibold tabular-nums">
            {stats.latestEndMin >= 0
              ? `${stats.latestEndDay ?? ""} ${minutesToTime(stats.latestEndMin)}`.trim()
              : "-"}
          </span>
        </div>
      </div>

      {/* quick breakdown chips */}
      <div className="flex flex-wrap gap-2">
        {shownPenalties.map((p, idx: number) => (
          <Badge
            key={`p-${idx}`}
            variant="outline"
            className="border-[var(--danger-border)] bg-[var(--danger-chip-bg)] text-[var(--danger)]"
            title={JSON.stringify(p)}
          >
            ❌ {penaltyLabel(p)}
          </Badge>
        ))}
        {shownBonuses.map((b, idx: number) => (
          <Badge key={`b-${idx}`} variant="secondary" title={JSON.stringify(b)}>
            ✅ {bonusLabel(b)}
          </Badge>
        ))}
        {shownComparative.map((c, idx: number) => (
          <Badge
            key={`c-${idx}`}
            variant="outline"
            className={
              c.tone === "bad"
                ? "border-[var(--danger-border)] bg-[var(--danger-chip-bg)] text-[var(--danger)]"
                : ""
            }
          >
            {c.label}
          </Badge>
        ))}
        {noChips && (
          <span className="text-xs text-muted-foreground">All options are similar</span>
        )}
      </div>
    </Card>
  );
}
