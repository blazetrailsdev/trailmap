import { describe, expect, it } from "vitest";
import {
  orderStoriesForRfc,
  rfcStoryCounts,
  storyStatusRank,
} from "../../app/models/concerns/rfc-progress.js";
import type { Story } from "../../app/models/index.js";

/** A story is only its id and status here; nothing else is read. */
function story(id: string, status: string): Story {
  return { id, status } as unknown as Story;
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
  it("orders by status and keeps index order inside a group", () => {
    const ordered = orderStoriesForRfc([
      story("d1", "done"),
      story("r1", "ready"),
      story("d2", "done"),
      story("p1", "in-progress"),
      story("r2", "ready"),
    ]);

    expect(ordered.map((s) => s.id)).toEqual(["p1", "r1", "r2", "d1", "d2"]);
  });

  it("does not mutate its argument", () => {
    const stories = [story("d1", "done"), story("r1", "ready")];
    orderStoriesForRfc(stories);
    expect(stories.map((s) => s.id)).toEqual(["d1", "r1"]);
  });
});

describe("rfcStoryCounts", () => {
  it("counts done against open", () => {
    expect(rfcStoryCounts([story("a", "done"), story("b", "ready"), story("c", "done")])).toEqual({
      total: 3,
      done: 2,
      open: 1,
      donePct: 66,
    });
  });

  it("leaves closed stories out of the total entirely", () => {
    expect(rfcStoryCounts([story("a", "done"), story("b", "closed")])).toEqual({
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
