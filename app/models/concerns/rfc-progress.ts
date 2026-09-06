/**
 * How an RFC's stories are ordered and counted on its show page.
 *
 * Both rules are ports, and both are load-bearing for the page matching
 * ringo's: `storyStatusRank` (`webhook/rfcs.go:31`) floats the actionable
 * work to the top and sinks `done` to the bottom, and `rfcStoryCounts`
 * (`webhook/spawnloop.go:1408`) drops `closed` stories from the denominator
 * entirely — a story that will never ship is not progress withheld, so
 * counting it would make every RFC that ever closed one look permanently
 * unfinished.
 */
import type { Story } from "../story.js";

/** Sort key: in-progress first, done last, anything unrecognised in between. */
export function storyStatusRank(status: string | null): number {
  switch (status) {
    case "in-progress":
      return 0;
    case "claimed":
      return 1;
    case "ready":
      return 2;
    case "blocked":
      return 3;
    case "draft":
      return 4;
    case "done":
      return 6;
    default:
      return 5;
  }
}

/**
 * `stories`, ordered for the page. `sort` is stable in every runtime this
 * targets, so index order survives inside a status group — matching Go's
 * `sort.SliceStable`.
 */
export function orderStoriesForRfc(stories: readonly Story[]): Story[] {
  return [...stories].sort((a, b) => storyStatusRank(a.status) - storyStatusRank(b.status));
}

export interface RfcStoryCounts {
  total: number;
  done: number;
  open: number;
  /** Whole per cent, floored, and 0 when nothing counts — as Go's int division. */
  donePct: number;
}

/** Total/done/open over `stories`, ignoring closed ones. */
export function rfcStoryCounts(stories: readonly Story[]): RfcStoryCounts {
  let total = 0;
  let done = 0;
  let open = 0;
  for (const story of stories) {
    if (story.status === "closed") continue;
    total++;
    if (story.status === "done") done++;
    else open++;
  }
  return { total, done, open, donePct: total > 0 ? Math.floor((done * 100) / total) : 0 };
}
