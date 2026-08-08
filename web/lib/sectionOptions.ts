import type { CourseSection, CourseSections, SectionLock } from "./api";

const KIND_TO_KEY = { LEC: "lecture", TUT: "tutorial", LAB: "lab" } as const;

type PinnableKind = keyof typeof KIND_TO_KEY;

/**
 * Does the course's matching rule tie this component to the lecture?
 */
function matchingApplies(data: CourseSections, kind: PinnableKind): boolean {
  if (!data.matching_required || kind === "LEC") return false;
  const wanted = kind === "TUT" ? "tutorial" : "lab";
  return data.matching_type === wanted || data.matching_type === "both";
}

/**
 * The sections a student may choose for one component type.
 *
 * Matching constrains the numeric group, not the individual section: on
 * MATH 1003 the pinned lecture L1 permits T1A, T1B, T1C and T1D. So a pinned
 * lecture narrows the list rather than determining it.
 */
export function optionsFor(
  data: CourseSections,
  kind: PinnableKind,
  lecturePin?: string
): CourseSection[] {
  const all = data.sections.filter((s) => s.type === kind);
  if (!matchingApplies(data, kind) || !lecturePin) return all;

  const lecture = data.sections.find((s) => s.section === lecturePin);
  // An unknown or ungrouped lecture cannot narrow anything; showing every
  // option is safer than showing none, and the backend still rejects an
  // invalid combination.
  if (!lecture?.group) return all;

  return all.filter((s) => s.group === lecture.group);
}

/**
 * Bring a course's pins back into agreement with what is actually selectable.
 *
 * Drops a pin that names a section which no longer exists or is no longer
 * permitted by the pinned lecture, and fills in a pin when narrowing leaves
 * exactly one candidate. Idempotent, so it is safe to run on every render.
 */
export function reconcilePins(data: CourseSections, pins: SectionLock): SectionLock {
  const next: SectionLock = {};

  const lectures = optionsFor(data, "LEC");
  if (pins.lecture && lectures.some((s) => s.section === pins.lecture)) {
    next.lecture = pins.lecture;
  }

  for (const kind of ["TUT", "LAB"] as const) {
    const key = KIND_TO_KEY[kind];
    const options = optionsFor(data, kind, next.lecture);
    if (options.length === 0) continue;

    const current = pins[key];
    if (current && options.some((s) => s.section === current)) {
      next[key] = current;
    } else if (matchingApplies(data, kind) && next.lecture && options.length === 1) {
      // Exactly one valid choice: pin it so the request matches what the
      // disabled control shows.
      next[key] = options[0].section;
    }
  }

  return next;
}
