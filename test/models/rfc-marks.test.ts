import { describe, expect, it } from "vitest";
import { collectRfcMarks, markTitle, type MarkEvent } from "../../app/models/concerns/rfc-marks.js";
import { rfcStalled } from "../../app/models/concerns/rfc-progress.js";

const event = (at: string, verb: string, storyId: string | null, rfcId: string, source = ""): MarkEvent => ({
  at,
  verb,
  storyId,
  rfcId,
  detail: source ? JSON.stringify({ source }) : null,
});

describe("collectRfcMarks", () => {
  const known = new Set(["r1", "r2"]);
  const storyRfc = new Map([["old", "r1"], ["a", "r1"], ["b", "r1"], ["c", "r2"], ["d", "r2"]]);

  it("marks the baseline, then the count at each refinement", () => {
    const marks = collectRfcMarks(known, storyRfc, [
      event("2026-09-01T10:00:00Z", "new", "a", "r1"),
      event("2026-09-02T10:00:00Z", "spawn", null, "r1", "rfc-refine"),
      event("2026-09-03T10:00:00Z", "new", "b", "r1"),
      event("2026-09-04T10:00:00Z", "spawn", null, "r1", "rfc-refine-auto"),
    ]);

    expect(marks.get("r1")).toEqual([
      { at: null, count: 1, kind: "origin", reps: 1 },
      { at: "2026-09-02T10:00:00Z", count: 2, kind: "refine", reps: 1 },
      { at: "2026-09-04T10:00:00Z", count: 3, kind: "refine", reps: 1 },
    ]);
  });

  it("starts an RFC with no baseline at its first day's burst", () => {
    const marks = collectRfcMarks(known, storyRfc, [
      event("2026-09-01T10:00:00Z", "new", "c", "r2"),
      event("2026-09-05T10:00:00Z", "new", "d", "r2"),
    ]);

    expect(marks.get("r2")).toEqual([{ at: null, count: 1, kind: "origin", reps: 1 }]);
    expect(markTitle(marks.get("r2")![0]!)).toBe("1 story when the RFC was written");
  });

  it("folds refinements that found the same count into one tick", () => {
    const marks = collectRfcMarks(known, storyRfc, [
      event("2026-09-02T10:00:00Z", "spawn", null, "r1", "rfc-refine"),
      event("2026-09-03T10:00:00Z", "spawn", null, "r1", "rfc-refine"),
    ]);

    expect(marks.get("r1")!.at(-1)).toMatchObject({ at: "2026-09-02T10:00:00Z", count: 3, reps: 2 });
    expect(markTitle(marks.get("r1")!.at(-1)!)).toBe(
      "3 stories at refinement on 2026-09-02 (2 refinements, unchanged)",
    );
  });

  it("ignores a spawn for a story, and an RFC-scoped one that is not a refinement", () => {
    const marks = collectRfcMarks(known, storyRfc, [
      event("2026-09-02T10:00:00Z", "spawn", "a", "r1", "rfc-refine"),
      event("2026-09-03T10:00:00Z", "spawn", null, "r1", "rfc-sunset"),
    ]);

    expect(marks.get("r1")).toEqual([{ at: null, count: 3, kind: "origin", reps: 1 }]);
  });
});

describe("rfcStalled", () => {
  it("is an active RFC with work waiting and none ready or in flight", () => {
    expect(rfcStalled("active", ["done", "draft"])).toBe(true);
    expect(rfcStalled("active", ["blocked"])).toBe(true);
  });

  it("is not one with a story ready, claimed or in progress", () => {
    for (const status of ["ready", "claimed", "in-progress"]) {
      expect(rfcStalled("active", ["draft", status])).toBe(false);
    }
  });

  it("is not a finished RFC, an empty one, or one that is not active", () => {
    expect(rfcStalled("active", ["done", "closed"])).toBe(false);
    expect(rfcStalled("active", [])).toBe(false);
    expect(rfcStalled("draft", ["draft"])).toBe(false);
  });
});
