"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CompareTimetableGrid } from "./TimetableGrid";
import { flattenSchedule, type Pinned } from "@/lib/schedule";

// Base UI treats value="" as "nothing selected" (SelectRoot.js:185), so the
// "(select)" item would be unselectable and the trigger would fall back to the
// placeholder. Carry a sentinel through the control and map it back to "" at
// the state boundary, because compareA/compareB feed the compare view as "".
const NO_SELECTION = "__none";

export function CompareSection({
  pinned,
  compareA,
  compareB,
  onCompareA,
  onCompareB,
  onUnpin,
  onRename,
}: Readonly<{
  pinned: Pinned[];
  compareA: string;
  compareB: string;
  onCompareA: (id: string) => void;
  onCompareB: (id: string) => void;
  onUnpin: (id: string) => void;
  onRename: (id: string, name: string) => void;
}>) {
  const pinnedA = pinned.find((p) => p.id === compareA) ?? null;
  const pinnedB = pinned.find((p) => p.id === compareB) ?? null;

  const meetingsA = useMemo(() => (pinnedA ? flattenSchedule(pinnedA.schedule) : []), [pinnedA]);
  const meetingsB = useMemo(() => (pinnedB ? flattenSchedule(pinnedB.schedule) : []), [pinnedB]);

  return (
    <Card className="py-5">
      <CardHeader>
        <h2 className="text-lg font-semibold">Compare Timetables</h2>
        <CardDescription>
          Pin options above, then select two to overlay and compare
        </CardDescription>
        <CardAction>
          <Badge variant="secondary">{pinned.length} pinned</Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* Pinned items list */}
        {pinned.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pinned.map((p) => (
              <Card key={p.id} size="sm" className="flex-row items-center gap-2 bg-muted px-3">
                <Input
                  type="text"
                  value={p.name}
                  onChange={(e) => onRename(p.id, e.target.value)}
                  aria-label={`Rename ${p.name}`}
                  className="h-auto w-full border-0 bg-transparent p-0 text-sm font-semibold shadow-none focus-visible:ring-0 lg:w-36"
                />
                <span className="text-xs text-muted-foreground">{p.score.toFixed(1)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
                  onClick={() => onUnpin(p.id)}
                  title="Unpin"
                  aria-label="Unpin"
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </Card>
            ))}
          </div>
        )}

        {/* Compare selectors */}
        {pinned.length >= 2 && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span
                className="inline-block size-3 rounded-[3px]"
                style={{
                  background: "hsl(var(--cmp-a) / 0.3)",
                  border: "1px solid hsl(var(--cmp-a) / 0.6)",
                }}
              />
              <Label htmlFor="compare-a" className="text-sm font-semibold">Option A:</Label>
              <Select
                value={compareA || NO_SELECTION}
                onValueChange={(v) => onCompareA(v === NO_SELECTION ? "" : String(v))}
                items={[
                  { value: NO_SELECTION, label: "(select)" },
                  ...pinned.map((p) => ({ value: p.id, label: p.name })),
                ]}
              >
                <SelectTrigger id="compare-a" size="sm" className="w-full lg:w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SELECTION}>(select)</SelectItem>
                  {pinned.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block size-3 rounded-[3px]"
                style={{
                  background: "hsl(var(--cmp-b) / 0.3)",
                  border: "1px solid hsl(var(--cmp-b) / 0.6)",
                }}
              />
              <Label htmlFor="compare-b" className="text-sm font-semibold">Option B:</Label>
              <Select
                value={compareB || NO_SELECTION}
                onValueChange={(v) => onCompareB(v === NO_SELECTION ? "" : String(v))}
                items={[
                  { value: NO_SELECTION, label: "(select)" },
                  ...pinned.map((p) => ({ value: p.id, label: p.name })),
                ]}
              >
                <SelectTrigger id="compare-b" size="sm" className="w-full lg:w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SELECTION}>(select)</SelectItem>
                  {pinned.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Overlay comparison grid */}
        {(pinnedA || pinnedB) && (
          <div>
            <div className="mb-2 text-sm text-muted-foreground">
              Hover over a class to temporarily hide the other timetable
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <CompareTimetableGrid
                  meetingsA={meetingsA}
                  meetingsB={meetingsB}
                  startHour={8}
                  endHour={20}
                />
              </div>
            </div>
          </div>
        )}

        {pinned.length < 2 && (
          <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
            Pin at least 2 options to enable comparison
          </div>
        )}
      </CardContent>
    </Card>
  );
}
