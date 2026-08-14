"use client";

import { Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DayCheckboxGroup, DayTimeGroup } from "./DayTimePrefs";
import {
  DAYS,
  NO_AFTER_TIMES,
  NO_BEFORE_TIMES,
  type DayPrefs,
  type GapShape,
  type WeightPrefs,
  type WeightPreset,
} from "./usePreferences";

export function PreferencesPanel({
  hard,
  soft,
  weights,
  error,
}: Readonly<{ hard: DayPrefs; soft: DayPrefs; weights: WeightPrefs; error: string }>) {
  return (
    <Card className="max-h-[520px] overflow-y-auto p-5">
      <h2 className="text-lg font-semibold">Preferences</h2>

      <div className="grid grid-cols-2 gap-4">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Hard preferences</CardTitle>
            <CardAction>
              <Dialog>
                <DialogTrigger
                  aria-label="About hard preferences"
                  className="inline-flex size-5 items-center justify-center rounded-full border border-border text-xs font-bold text-muted-foreground hover:bg-muted"
                >
                  <Info className="size-3" aria-hidden />
                </DialogTrigger>
                <DialogContent className="max-w-md sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Hard preferences</DialogTitle>
                    <DialogDescription>
                      Hard preferences are non-negotiable constraints. If a timetable
                      violates one, it is rejected.
                    </DialogDescription>
                  </DialogHeader>
                  <ul className="ml-4 list-disc text-sm text-foreground">
                    <li>No classes before 10:30</li>
                    <li>Keep Friday completely free</li>
                    <li>Avoid clashes (required)</li>
                  </ul>
                </DialogContent>
              </Dialog>
            </CardAction>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            {/* Hard Free Days (multi-select) */}
            <div>
              <div className="mb-2 text-sm font-semibold">Must be free</div>
              <DayCheckboxGroup
                idPrefix="hard-free"
                days={DAYS}
                selected={hard.freeDays}
                onChange={hard.setFreeDays}
              />
            </div>

            {/* Hard No Classes After */}
            <div>
              <div className="mb-2 text-sm font-semibold">No classes after</div>
              <DayTimeGroup
                idPrefix="hard-after"
                days={DAYS}
                values={hard.noAfter}
                times={NO_AFTER_TIMES}
                onChange={hard.setNoAfter}
              />
            </div>

            {/* Hard No Classes Before */}
            <div>
              <div className="mb-2 text-sm font-semibold">No classes before</div>
              <DayTimeGroup
                idPrefix="hard-before"
                days={DAYS}
                values={hard.noBefore}
                times={NO_BEFORE_TIMES}
                onChange={hard.setNoBefore}
              />
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Soft preferences</CardTitle>
            <CardAction>
              <Dialog>
                <DialogTrigger
                  aria-label="About soft preferences"
                  className="inline-flex size-5 items-center justify-center rounded-full border border-border text-xs font-bold text-muted-foreground hover:bg-muted"
                >
                  <Info className="size-3" aria-hidden />
                </DialogTrigger>
                <DialogContent className="max-w-md sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Soft preferences</DialogTitle>
                    <DialogDescription>
                      Soft preferences are nice-to-haves. The optimiser will try to
                      satisfy them, but may trade them off to find a feasible timetable.
                    </DialogDescription>
                  </DialogHeader>
                  <ul className="ml-4 list-disc text-sm text-foreground">
                    <li>Minimize gaps between classes</li>
                    <li>Prefer compact schedules</li>
                    <li>Prefer fewer days on campus</li>
                  </ul>
                </DialogContent>
              </Dialog>
            </CardAction>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            {/* Soft Free Days (multi-select) */}
            <div>
              <div className="mb-2 text-sm font-semibold">Prefer free</div>
              <DayCheckboxGroup
                idPrefix="soft-free"
                days={DAYS}
                selected={soft.freeDays}
                onChange={soft.setFreeDays}
              />
            </div>

            {/* Soft No Classes After */}
            <div>
              <div className="mb-2 text-sm font-semibold">No classes after</div>
              <DayTimeGroup
                idPrefix="soft-after"
                days={DAYS}
                values={soft.noAfter}
                times={NO_AFTER_TIMES}
                onChange={soft.setNoAfter}
              />
            </div>

            {/* Soft No Classes Before */}
            <div>
              <div className="mb-2 text-sm font-semibold">No classes before</div>
              <DayTimeGroup
                idPrefix="soft-before"
                days={DAYS}
                values={soft.noBefore}
                times={NO_BEFORE_TIMES}
                onChange={soft.setNoBefore}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Weights + style prefs (outside soft box) */}
      <div>
        <div className="mb-2 text-sm font-semibold">Weights & style</div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <span className="w-36">Gap penalty:</span>
            <Select
              value={weights.gapWeightPreset}
              onValueChange={(v) => weights.setGapWeightPreset(v as WeightPreset)}
            >
              <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Low">Low</SelectItem>
                <SelectItem value="Med">Med</SelectItem>
                <SelectItem value="High">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground">
            <span className="w-36">Early/late penalty:</span>
            <Select
              value={weights.earlyLateWeightPreset}
              onValueChange={(v) => weights.setEarlyLateWeightPreset(v as WeightPreset)}
            >
              <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Low">Low</SelectItem>
                <SelectItem value="Med">Med</SelectItem>
                <SelectItem value="High">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground">
            <span className="w-36">Gap shape:</span>
            <Select
              value={weights.gapShape}
              onValueChange={(v) => weights.setGapShape(v as GapShape)}
              items={[
                { value: "no_preference", label: "No preference" },
                { value: "consolidated", label: "Prefer one long gap" },
                { value: "fragmented", label: "Prefer several short gaps" },
              ]}
            >
              <SelectTrigger size="sm" className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="no_preference">No preference</SelectItem>
                <SelectItem value="consolidated">Prefer one long gap</SelectItem>
                <SelectItem value="fragmented">Prefer several short gaps</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2 text-sm text-foreground">
          <div className="flex items-center gap-2">
            <Checkbox
              id="prefer-one-free-day"
              checked={weights.preferOneFreeDay}
              onCheckedChange={(checked) => weights.setPreferOneFreeDay(checked === true)}
            />
            <Label htmlFor="prefer-one-free-day" className="font-normal">
              Prefer at least one free weekday
            </Label>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-6 whitespace-pre-wrap rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}
    </Card>
  );
}
