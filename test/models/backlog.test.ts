import { describe, expect, it } from "vitest";
import {
  ICEBOX_RFC_STATUSES,
  iceboxed,
  isBacklogFilter,
  matchesBacklogFilter,
  orderBacklog,
} from "../../app/models/concerns/backlog.ts";
import type { Story } from "../../app/models/index.ts";

/** A story is only its id, rfc and status here; nothing else is read. */
function story(id: string, status: string, rfcId = "rfc"): Story {
  return { id, status, rfc_id: rfcId } as unknown as Story;
}

const rfcStatus = new Map([
  ["rfc", "active"],
  ["idea", "draft"],
  ["later", "postponed"],
]);

describe("ICEBOX_RFC_STATUSES", () => {
  it("ices the two RFC states that mean nobody should pick this yet", () => {
    // ringo's `ICEBOX_RFC_STATUS` (webhook/backlog.go:164). `closed` and
    // `superseded` are deliberately absent: those RFCs' stories leave the
    // backlog entirely rather than land in the Icebox.
    expect([...ICEBOX_RFC_STATUSES]).toEqual(["draft", "postponed"]);
  });
});

describe("iceboxed", () => {
  it("judges by the parent RFC's status, never the story's own", () => {
    expect(iceboxed(story("a", "ready", "idea"), rfcStatus)).toBe(true);
    expect(iceboxed(story("b", "ready", "later"), rfcStatus)).toBe(true);
    expect(iceboxed(story("c", "draft"), rfcStatus)).toBe(false);
    // An RFC the snapshot does not hold ices nothing: unknown is not draft.
    expect(iceboxed(story("d", "ready", "vanished"), rfcStatus)).toBe(false);
  });
});

describe("matchesBacklogFilter", () => {
  const match = (s: Story, f: Parameters<typeof matchesBacklogFilter>[1]) =>
    matchesBacklogFilter(s, f, rfcStatus);

  it("opens on everything not done and not iced", () => {
    expect(match(story("a", "ready"), "open")).toBe(true);
    expect(match(story("b", "done"), "open")).toBe(false);
    expect(match(story("c", "ready", "idea"), "open")).toBe(false);
  });

  it("ices unfinished work only — a done story is not an idea again", () => {
    expect(match(story("a", "ready", "idea"), "icebox")).toBe(true);
    expect(match(story("b", "done", "idea"), "icebox")).toBe(false);
  });

  it("partitions the drafts between Draft and Icebox", () => {
    expect(match(story("a", "draft"), "draft")).toBe(true);
    expect(match(story("b", "draft", "idea"), "draft")).toBe(false);
  });

  it("leaves the status tabs alone, so live work is never hidden", () => {
    // A ready story under a draft RFC is still in the ready queue.
    expect(match(story("a", "ready", "idea"), "ready")).toBe(true);
    expect(match(story("b", "blocked", "idea"), "blocked")).toBe(true);
  });

  it("recognises exactly the filters it serves", () => {
    expect(isBacklogFilter("icebox")).toBe(true);
    expect(isBacklogFilter("closed")).toBe(false);
  });
});

describe("orderBacklog", () => {
  it("groups by status, actionable first and done last", () => {
    const rows = orderBacklog(
      [story("d", "done"), story("b", "ready"), story("a", "in-progress"), story("c", "draft")],
      new Map(),
    );

    expect(rows.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("floats the ready queue to the top of its group, in pick order", () => {
    const rows = orderBacklog(
      [story("a", "ready"), story("b", "ready"), story("c", "ready")],
      new Map([["c", 0], ["b", 1]]),
    );

    expect(rows.map((s) => s.id)).toEqual(["c", "b", "a"]);
  });

  it("sinks a status it does not rank below every one it does", () => {
    const rows = orderBacklog([story("a", "invented"), story("b", "done")], new Map());

    expect(rows.map((s) => s.id)).toEqual(["b", "a"]);
  });
});
