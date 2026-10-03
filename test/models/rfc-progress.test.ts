import { describe, expect, it } from "vitest";
import {
  orderRfcsForIndex,
  orderStoriesForRfc,
  rfcStoryCounts,
  rfcTerminal,
  storyBarLength,
  storyBarScale,
  storyStatusCounts,
  storyStatusRank,
} from "../../app/models/concerns/rfc-progress.js";
import type { Story } from "../../app/models/index.js";

/** A story is its id, status and priority here; nothing else is read. */
function story(id: string, status: string, priority: number | null = null): Story {
  return { id, status, priority } as unknown as Story;
}

describe("storyStatusRank", () => {
  it("floats the actionable statuses and sinks done", () => {
    expect(
      ["done", "draft", "blocked", "ready", "claimed", "in-progress"].map(storyStatusRank),
    ).toEqual([6, 4, 3, 2, 1, 0]);
  });

  it("puts an unrecognised status ahead of done, not behind it", () => {
    expect(storyStatusRank("closed")).toBe(5);
    expect(storyStatusRank(null)).toBe(5);
    expect(storyStatusRank("closed")).toBeLessThan(storyStatusRank("done"));
  });
});

describe("orderStoriesForRfc", () => {
  it("orders by status and by id inside a group", () => {
    const ordered = orderStoriesForRfc(
      [
        story("d1", "done"),
        story("r1", "ready"),
        story("d2", "done"),
        story("p1", "in-progress"),
        story("r2", "ready"),
      ],
      "active",
    );

    expect(ordered.map((s) => s.id)).toEqual(["p1", "r1", "r2", "d1", "d2"]);
  });

  it("breaks a status tie on priority before id, unset last", () => {
    const ordered = orderStoriesForRfc(
      [story("a", "ready"), story("b", "ready", 2), story("c", "ready", 0), story("d", "ready", 2)],
      "active",
    );

    expect(ordered.map((s) => s.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("does not depend on the order the rows arrive in", () => {
    const rows = [story("b", "ready", 2), story("c", "ready", 0), story("a", "ready")];
    const reversed = [...rows].reverse();

    expect(orderStoriesForRfc(rows, "active").map((s) => s.id)).toEqual(
      orderStoriesForRfc(reversed, "active").map((s) => s.id),
    );
  });

  it("ranks a ready story under a non-active RFC as the draft it effectively is", () => {
    const stories = [story("r", "ready"), story("b", "blocked")];

    expect(orderStoriesForRfc(stories, "active").map((s) => s.id)).toEqual(["r", "b"]);
    expect(orderStoriesForRfc(stories, "draft").map((s) => s.id)).toEqual(["b", "r"]);
  });

  it("does not mutate its argument", () => {
    const stories = [story("d1", "done"), story("r1", "ready")];
    orderStoriesForRfc(stories, "active");
    expect(stories.map((s) => s.id)).toEqual(["d1", "r1"]);
  });
});

describe("rfcStoryCounts", () => {
  it("counts done against open", () => {
    expect(rfcStoryCounts(["done", "ready", "done"])).toEqual({
      total: 3,
      done: 2,
      open: 1,
      donePct: 66,
    });
  });

  it("leaves closed stories out of the total entirely", () => {
    expect(rfcStoryCounts(["done", "closed"])).toEqual({
      total: 1,
      done: 1,
      open: 0,
      donePct: 100,
    });
  });

  it("reports 0% rather than dividing by zero for an empty RFC", () => {
    expect(rfcStoryCounts([])).toEqual({ total: 0, done: 0, open: 0, donePct: 0 });
  });
});

describe("storyStatusCounts", () => {
  it("orders the segments shipped, dead, moving, queued, stuck, not started", () => {
    const counts = storyStatusCounts(["draft", "ready", "done", "blocked"], "active");

    expect(counts.map((c) => c.status)).toEqual(["done", "ready", "blocked", "draft"]);
    expect(counts.map((c) => c.pct)).toEqual([25, 25, 25, 25]);
  });

  it("counts the closed stories the done/total headline drops", () => {
    // The two numbers are different questions: the bar is what the RFC is made
    // of, `rfcStoryCounts` is how much of it has shipped.
    const counts = storyStatusCounts(["done", "closed"], "active");

    expect(counts).toEqual([
      { status: "done", count: 1, pct: 50 },
      { status: "closed", count: 1, pct: 50 },
    ]);
    expect(rfcStoryCounts(["done", "closed"]).total).toBe(1);
  });

  it("segments a ready story under a draft RFC as the draft the queue sees", () => {
    // The one status rule (`app/views/shared/_status-badge`): the bar has a
    // ready segment and a draft segment, so the override has to move the story
    // between them or the bar advertises work nothing can claim.
    const stories = ["ready", "draft"];

    expect(storyStatusCounts(stories, "active").map((c) => c.status)).toEqual(["ready", "draft"]);
    expect(storyStatusCounts(stories, "draft")).toEqual([{ status: "draft", count: 2, pct: 100 }]);
  });

  it("appends a status it does not know rather than under-reporting the RFC", () => {
    const counts = storyStatusCounts(["done", "invented"], "active");

    expect(counts.map((c) => c.status)).toEqual(["done", "invented"]);
  });
});

describe("orderRfcsForIndex", () => {
  const rfc = (id: string, priority: number | null) => ({ id, priority });

  it("ranks by priority, unprioritized last", () => {
    const rows = orderRfcsForIndex([rfc("c", null), rfc("a", 5), rfc("b", 1)], new Map());

    expect(rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("breaks an equal explicit priority on fewer stories left, then on id", () => {
    const open = new Map([["a", 9], ["b", 2], ["c", 2]]);
    const rows = orderRfcsForIndex([rfc("a", 2), rfc("c", 2), rfc("b", 2)], open);

    expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("leaves unprioritized RFCs in id order rather than reshuffling them by size", () => {
    // ringo applies the fewer-remaining tiebreak only when BOTH sides set a
    // priority; an RFC nobody prioritized is not reordered by how big it is.
    const open = new Map([["a", 9], ["b", 2]]);
    const rows = orderRfcsForIndex([rfc("b", null), rfc("a", null)], open);

    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("rfcTerminal", () => {
  it("counts closed and superseded as not open", () => {
    expect(rfcTerminal("closed")).toBe(true);
    expect(rfcTerminal("superseded")).toBe(true);
    expect(rfcTerminal("active")).toBe(false);
    expect(rfcTerminal("postponed")).toBe(false);
    expect(rfcTerminal(null)).toBe(false);
  });
});

describe("storyBarScale", () => {
  it("takes the 95th percentile, so one freak RFC does not set the scale", () => {
    // Forty ordinary RFCs of 5 to 200 stories, and one with 1521. The
    // reference lands among the ordinary ones; the freak clamps instead of
    // leaving everything else a stub.
    const ordinary = Array.from({ length: 40 }, (_, i) => (i + 1) * 5);
    expect(storyBarScale([...ordinary, 1521])).toBe(195);
  });

  it("ignores RFCs with no stories, and is zero when none has any", () => {
    expect(storyBarScale([0, 0, 40, 0])).toBe(40);
    expect(storyBarScale([0, 0])).toBe(0);
    expect(storyBarScale([])).toBe(0);
  });

  it("does not depend on the order the RFCs arrive in", () => {
    expect(storyBarScale([300, 2, 50, 9])).toBe(storyBarScale([2, 9, 50, 300]));
  });
});

describe("storyBarLength", () => {
  it("grows with the story count, by square root", () => {
    // Against a scale of 400: 4 stories is a tenth of the way, 100 is half,
    // 400 is all of it — of the span between ringo's 26px floor and 400px.
    expect(storyBarLength(4, 400).pct).toBe(15.85);
    expect(storyBarLength(100, 400).pct).toBe(53.25);
    expect(storyBarLength(400, 400).pct).toBe(100);
    expect(storyBarLength(4, 400).pct).toBeLessThan(storyBarLength(100, 400).pct);
  });

  it("keeps a one-story RFC a bar rather than a dot", () => {
    expect(storyBarLength(1, 400).pct).toBeGreaterThan(6.5);
  });

  it("clamps an RFC past the scale to full length, and says it did", () => {
    expect(storyBarLength(1521, 400)).toEqual({ pct: 100, clamped: true });
    // Reaching the scale is not exceeding it.
    expect(storyBarLength(400, 400)).toEqual({ pct: 100, clamped: false });
  });

  it("draws full length when there is no scale to compare against", () => {
    expect(storyBarLength(3, 0)).toEqual({ pct: 100, clamped: false });
  });
});
