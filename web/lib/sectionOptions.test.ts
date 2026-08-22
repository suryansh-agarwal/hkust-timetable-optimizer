import { describe, expect, it } from "vitest";
import { optionsFor, reconcilePins, summariseMeetings } from "./sectionOptions";
import type { CourseSections } from "./api";

function sec(section: string, type: "LEC" | "TUT" | "LAB", group: string | null) {
  return { section, type, group, instructor: null, meetings: [] };
}

// MATH 1003 shape: matching on tutorials, four tutorials per lecture group.
const MATCHED: CourseSections = {
  course_code: "MATH 1003",
  matching_required: true,
  matching_type: "tutorial",
  sections: [
    sec("L1", "LEC", "1"), sec("L2", "LEC", "2"),
    sec("T1A", "TUT", "1"), sec("T1B", "TUT", "1"),
    sec("T2A", "TUT", "2"), sec("T2B", "TUT", "2"),
  ],
};

const UNMATCHED: CourseSections = {
  course_code: "ECON 2103",
  matching_required: false,
  matching_type: null,
  sections: [
    sec("L1", "LEC", "1"), sec("L2", "LEC", "2"),
    sec("T1", "TUT", "1"), sec("T2", "TUT", "2"),
  ],
};

describe("optionsFor", () => {
  it("returns every section of the kind when no lecture is pinned", () => {
    expect(optionsFor(MATCHED, "TUT").map((s) => s.section))
      .toEqual(["T1A", "T1B", "T2A", "T2B"]);
  });

  it("narrows tutorials to the pinned lecture's group on a matched course", () => {
    expect(optionsFor(MATCHED, "TUT", "L1").map((s) => s.section))
      .toEqual(["T1A", "T1B"]);
  });

  it("does not narrow when the course has no matching rule", () => {
    expect(optionsFor(UNMATCHED, "TUT", "L1").map((s) => s.section))
      .toEqual(["T1", "T2"]);
  });

  it("does not narrow labs when matching_type is tutorial only", () => {
    const withLabs: CourseSections = {
      ...MATCHED,
      sections: [...MATCHED.sections, sec("LA1", "LAB", "1"), sec("LA2", "LAB", "2")],
    };
    expect(optionsFor(withLabs, "LAB", "L1").map((s) => s.section))
      .toEqual(["LA1", "LA2"]);
  });

  it("narrows labs too when matching_type is both", () => {
    const both: CourseSections = {
      ...MATCHED,
      matching_type: "both",
      sections: [...MATCHED.sections, sec("LA1", "LAB", "1"), sec("LA2", "LAB", "2")],
    };
    expect(optionsFor(both, "LAB", "L1").map((s) => s.section)).toEqual(["LA1"]);
  });

  it("falls back to every option when the pinned lecture is unknown", () => {
    expect(optionsFor(MATCHED, "TUT", "L9").map((s) => s.section))
      .toEqual(["T1A", "T1B", "T2A", "T2B"]);
  });

  it("falls back to every option when the pinned lecture has no group", () => {
    const nullGroupLecture: CourseSections = {
      ...MATCHED,
      sections: MATCHED.sections.map((s) =>
        s.section === "L1" ? { ...s, group: null } : s
      ),
    };
    expect(optionsFor(nullGroupLecture, "TUT", "L1").map((s) => s.section))
      .toEqual(["T1A", "T1B", "T2A", "T2B"]);
  });
});

describe("reconcilePins", () => {
  it("keeps a tutorial pin that is still valid", () => {
    expect(reconcilePins(MATCHED, { lecture: "L1", tutorial: "T1B" }))
      .toEqual({ lecture: "L1", tutorial: "T1B" });
  });

  it("clears a tutorial pin invalidated by changing the lecture", () => {
    // Was L1+T1B; the student switched to L2, so T1B is impossible.
    expect(reconcilePins(MATCHED, { lecture: "L2", tutorial: "T1B" }))
      .toEqual({ lecture: "L2" });
  });

  it("auto-selects when narrowing leaves exactly one option", () => {
    const single: CourseSections = {
      ...MATCHED,
      sections: [sec("L1", "LEC", "1"), sec("L2", "LEC", "2"), sec("T1", "TUT", "1"), sec("T2", "TUT", "2")],
    };
    expect(reconcilePins(single, { lecture: "L1" })).toEqual({ lecture: "L1", tutorial: "T1" });
  });

  it("does not auto-select when several options remain", () => {
    expect(reconcilePins(MATCHED, { lecture: "L1" })).toEqual({ lecture: "L1" });
  });

  it("does not auto-select on an unmatched course even with a single option", () => {
    // Only one tutorial exists, but matching is not required for this course,
    // so pinning the lecture must not invent a tutorial constraint.
    const unmatchedSingleTut: CourseSections = {
      ...UNMATCHED,
      sections: [sec("L1", "LEC", "1"), sec("L2", "LEC", "2"), sec("T1", "TUT", "1")],
    };
    expect(reconcilePins(unmatchedSingleTut, { lecture: "L1" })).toEqual({ lecture: "L1" });
  });

  it("drops a lab pin for a course with no lab sections without disturbing other pins", () => {
    expect(reconcilePins(MATCHED, { lecture: "L1", tutorial: "T1B", lab: "LA1" }))
      .toEqual({ lecture: "L1", tutorial: "T1B" });
  });

  it("leaves pins alone on an unmatched course", () => {
    expect(reconcilePins(UNMATCHED, { lecture: "L1", tutorial: "T2" }))
      .toEqual({ lecture: "L1", tutorial: "T2" });
  });

  it("drops a pin naming a section that does not exist", () => {
    expect(reconcilePins(MATCHED, { lecture: "L1", tutorial: "T9Z" }))
      .toEqual({ lecture: "L1" });
  });

  it("drops every pin on a lecture-less course", () => {
    // RMBI 4980 shape: tutorials and labs, no lecture. The backend blocks any
    // pin here, and the picker renders no tutorial/lab control, so a pin that
    // survived would be unclearable and would block every optimise.
    const noLectures: CourseSections = {
      course_code: "RMBI 4980",
      matching_required: false,
      matching_type: null,
      sections: [
        sec("T1", "TUT", "1"), sec("T2", "TUT", "2"),
        sec("LA1", "LAB", "1"), sec("LA2", "LAB", "2"),
      ],
    };
    expect(reconcilePins(noLectures, { tutorial: "T2", lab: "LA1" })).toEqual({});
  });

  it("is idempotent", () => {
    const once = reconcilePins(MATCHED, { lecture: "L2", tutorial: "T1B" });
    expect(reconcilePins(MATCHED, once)).toEqual(once);
  });
});

describe("summariseMeetings", () => {
  const m = (day: string, start: string) => ({ day, start });

  it("groups days that share a start time", () => {
    expect(summariseMeetings([m("Tu", "10:30"), m("Th", "10:30")])).toBe("Tu/Th 10:30");
  });

  it("keeps days apart when their times differ - the bug this exists for", () => {
    // Monday afternoon, Friday morning. The old form read "Mo/Fr 16:30" and
    // hid the 09:00 entirely.
    expect(summariseMeetings([m("Mo", "16:30"), m("Fr", "09:00")])).toBe("Mo 16:30, Fr 09:00");
  });

  it("handles a mix of shared and unshared times", () => {
    expect(summariseMeetings([m("Mo", "09:00"), m("We", "09:00"), m("Fr", "14:00")]))
      .toBe("Mo/We 09:00, Fr 14:00");
  });

  it("reads a single meeting plainly", () => {
    expect(summariseMeetings([m("We", "13:00")])).toBe("We 13:00");
  });

  it("says so when a section has no meetings rather than rendering an empty string", () => {
    expect(summariseMeetings([])).toBe("no meetings");
  });

  it("preserves day order rather than sorting by time", () => {
    // Friday is earlier in the day but later in the week; the label should
    // read the way the week does.
    expect(summariseMeetings([m("Mo", "16:30"), m("Fr", "09:00")])).toMatch(/^Mo /);
  });

  it("does not repeat a day that meets twice in the same slot", () => {
    expect(summariseMeetings([m("Mo", "09:00"), m("Mo", "09:00")])).toBe("Mo 09:00");
  });
});
