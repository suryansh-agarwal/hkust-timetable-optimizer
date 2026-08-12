"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div style={{ marginTop: 20, borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Compare Timetables</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Pin options above, then select two to overlay and compare
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-subtle)" }}>{pinned.length} pinned</div>
      </div>

      {/* Pinned items list */}
      {pinned.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {pinned.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: "6px 10px",
                background: "var(--surface-2)",
                fontSize: 13,
              }}
            >
              <Input
                type="text"
                value={p.name}
                onChange={(e) => onRename(p.id, e.target.value)}
                aria-label={`Rename ${p.name}`}
                className="h-auto w-36 border-0 bg-transparent p-0 text-sm font-semibold shadow-none focus-visible:ring-0"
              />
              <span style={{ fontSize: 12, color: "var(--text-subtle)" }}>{p.score.toFixed(1)}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onUnpin(p.id)}
                title="Unpin"
                aria-label="Unpin"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Compare selectors */}
      {pinned.length >= 2 && (
        <div style={{ marginTop: 14, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                borderRadius: 3,
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
              <SelectTrigger id="compare-a" size="sm" className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SELECTION}>(select)</SelectItem>
                {pinned.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                borderRadius: 3,
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
              <SelectTrigger id="compare-b" size="sm" className="w-48"><SelectValue /></SelectTrigger>
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
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
            Hover over a class to temporarily hide the other timetable
          </div>
          <CompareTimetableGrid
            meetingsA={meetingsA}
            meetingsB={meetingsB}
            startHour={8}
            endHour={20}
          />
        </div>
      )}

      {pinned.length < 2 && (
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-subtle)", fontStyle: "italic" }}>
          Pin at least 2 options to enable comparison
        </div>
      )}
    </div>
  );
}
