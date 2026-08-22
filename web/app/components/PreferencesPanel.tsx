"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  // Open on desktop, collapsed on a phone: below lg the panel is ~30 controls
  // in one column. Read after mount rather than during render - the server
  // has no viewport, and branching on one would be a hydration mismatch.
  const [openByDefault, setOpenByDefault] = useState(true);
  // True until the mount effect below runs. The server renders the panels open
  // because it has no viewport, so on a phone the first paint would show ~30
  // controls that the effect then collapses. While this is true the content is
  // hidden below lg, so that frame never reaches the screen. At lg and above
  // the class does not apply and the desktop render is untouched.
  const [beforeHydration, setBeforeHydration] = useState(true);
  useEffect(() => {
    // One-time sync with the browser's viewport on mount. This is the
    // documented exception to the rule below: reading it during render
    // would be a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenByDefault(window.matchMedia("(min-width: 1024px)").matches);
    // The disable above covers this call too: the rule reports once per
    // effect, on whichever setState it reaches first. Reordering these two
    // lines would move the violation here, unguarded, and fail lint.
    setBeforeHydration(false);
  }, []);

  return (
    <Card className="max-h-none overflow-visible p-5 lg:max-h-[520px] lg:overflow-y-auto">
      <h2 className="text-lg font-semibold">Preferences</h2>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card size="sm">
          <Collapsible
            defaultOpen={openByDefault}
            // defaultOpen is only read on mount, so changing this key forces
            // the Collapsible to remount and pick up the new default once the
            // breakpoint effect above resolves.
            key={`hard-${openByDefault}`}
            className="flex flex-col gap-(--card-spacing)"
          >
            <CardHeader>
              <CollapsibleTrigger className="group flex min-h-11 w-full items-center justify-between text-left lg:min-h-0">
                <CardTitle className="text-sm font-semibold">Hard preferences</CardTitle>
                <ChevronDown
                  className="size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-180"
                  aria-hidden
                />
              </CollapsibleTrigger>
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

            <CollapsibleContent className={beforeHydration ? "max-lg:hidden" : undefined}>
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
            </CollapsibleContent>
          </Collapsible>
        </Card>

        <Card size="sm">
          <Collapsible
            defaultOpen={openByDefault}
            // defaultOpen is only read on mount, so changing this key forces
            // the Collapsible to remount and pick up the new default once the
            // breakpoint effect above resolves.
            key={`soft-${openByDefault}`}
            className="flex flex-col gap-(--card-spacing)"
          >
            <CardHeader>
              <CollapsibleTrigger className="group flex min-h-11 w-full items-center justify-between text-left lg:min-h-0">
                <CardTitle className="text-sm font-semibold">Soft preferences</CardTitle>
                <ChevronDown
                  className="size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-180"
                  aria-hidden
                />
              </CollapsibleTrigger>
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

            <CollapsibleContent className={beforeHydration ? "max-lg:hidden" : undefined}>
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
            </CollapsibleContent>
          </Collapsible>
        </Card>
      </div>

      {/* Weights + style prefs (outside soft box) */}
      <div>
        <div className="mb-2 text-sm font-semibold">Weights & style</div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1 text-sm text-foreground lg:flex-row lg:items-center lg:gap-2">
            <span className="lg:w-36">Gap penalty:</span>
            <Select
              value={weights.gapWeightPreset}
              onValueChange={(v) => weights.setGapWeightPreset(v as WeightPreset)}
            >
              <SelectTrigger size="sm" className="w-full lg:w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Low">Low</SelectItem>
                <SelectItem value="Med">Med</SelectItem>
                <SelectItem value="High">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 text-sm text-foreground lg:flex-row lg:items-center lg:gap-2">
            <span className="lg:w-36">Early/late penalty:</span>
            <Select
              value={weights.earlyLateWeightPreset}
              onValueChange={(v) => weights.setEarlyLateWeightPreset(v as WeightPreset)}
            >
              <SelectTrigger size="sm" className="w-full lg:w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Low">Low</SelectItem>
                <SelectItem value="Med">Med</SelectItem>
                <SelectItem value="High">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 text-sm text-foreground lg:flex-row lg:items-center lg:gap-2">
            <span className="lg:w-36">Gap shape:</span>
            <Select
              value={weights.gapShape}
              onValueChange={(v) => weights.setGapShape(v as GapShape)}
              items={[
                { value: "no_preference", label: "No preference" },
                { value: "consolidated", label: "Prefer one long gap" },
                { value: "fragmented", label: "Prefer several short gaps" },
              ]}
            >
              <SelectTrigger size="sm" className="w-full lg:w-56"><SelectValue /></SelectTrigger>
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
        <div className="whitespace-pre-wrap rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}
    </Card>
  );
}
