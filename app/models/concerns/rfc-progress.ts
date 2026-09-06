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

/**
 * Sort key: in-progress first, done last, anything else in between.
 *
 * `closed` deliberately has NO arm of its own. It is a real status
 * (`STORY_STATUSES`), so its absence reads like an oversight — but ringo's
 * switch has no `case "closed"` either, and a closed story lands on the
 * default 5 there exactly as it does here. Verified against the source at
 * `webhook/rfcs.go:31` (btwebooks a49051f), which ends:
 *
 *     case "done":
 *             return 6
 *     default:
 *             return 5
 *
 * Adding an explicit arm would read as tidier and would be a divergence from
 * the thing this is a port of, so the fall-through stays and the test pins
 * the value.
 */
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

/** One story status and how many of an RFC's stories hold it. */
export interface StatusCount {
  status: string;
  count: number;
  /**
   * Share of the RFC's stories, as a percentage — the bar segment's width.
   * Rounded to two places: the exact ratio prints seventeen digits into the
   * `style` attribute, and no display can spend them.
   */
  pct: number;
}

/**
 * The bar's segment order: shipped, then dead, then moving, queued, stuck, and
 * finally not-started. Read left to right it is the RFC's progress and the tail
 * is what is left — ringo's `STORY_STATES` (webhook/rfcs.go:465, btwebooks
 * `7897c57`), kept in that order because the reading is the point.
 */
const STORY_BAR_ORDER: readonly string[] = [
  "done",
  "closed",
  "in-progress",
  "claimed",
  "ready",
  "blocked",
  "draft",
];

/**
 * `stories` counted by status, in bar order, with anything unrecognised
 * appended in id order rather than dropped.
 *
 * Unlike `rfcStoryCounts` this counts `closed` — the bar is the composition of
 * the RFC's stories, not its progress, and a closed story is part of what is
 * there. The two disagreeing is deliberate and is ringo's split too:
 * `story_status` carries every status while `rfcStoryCounts` decides the
 * done/total headline.
 */
export function storyStatusCounts(stories: readonly Story[]): StatusCount[] {
  const counts = new Map<string, number>();
  for (const story of stories) {
    const status = String(story.status ?? "unknown");
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const known = STORY_BAR_ORDER.filter((status) => counts.has(status));
  const rest = [...counts.keys()].filter((status) => !STORY_BAR_ORDER.includes(status)).sort();
  const total = stories.length;
  return [...known, ...rest].map((status) => {
    const count = counts.get(status) ?? 0;
    return {
      status,
      count,
      pct: total > 0 ? Math.round((10_000 * count) / total) / 100 : 0,
    };
  });
}

/**
 * The RFC list's order: priority ascending, unset last. ringo's comparator is
 * webhook/rfcs.go:595-611, which opens
 * `const prio = r => (r.priority == null ? Number.MAX_SAFE_INTEGER : r.priority);`
 * and applies the fewer-remaining tiebreak under `if (a.priority != null &&
 * b.priority != null)`.
 *
 * The tiebreak is the interesting half and it is ringo's, which is in turn the
 * CLI's `comparePriority` one level up: among RFCs that set the SAME EXPLICIT
 * priority, fewer open stories sorts first, and id breaks what remains. It
 * applies only when both priorities are explicit — an RFC with no priority is
 * left in id order rather than reshuffled by size, matching the ranking rule
 * `comparePriority` applies to stories (`concerns/ranking.ts`), which returns 0
 * unless both sides inherit the same explicit RFC priority.
 */
export function orderRfcsForIndex<T extends { id: string; priority: number | null }>(
  rfcs: readonly T[],
  openCount: ReadonlyMap<string, number>,
): T[] {
  const rank = (rfc: T) => rfc.priority ?? Number.MAX_SAFE_INTEGER;
  return [...rfcs].sort((a, b) => {
    const byPriority = rank(a) - rank(b);
    if (byPriority !== 0) return byPriority;
    if (a.priority !== null && b.priority !== null) {
      const byOpen = (openCount.get(a.id) ?? 0) - (openCount.get(b.id) ?? 0);
      if (byOpen !== 0) return byOpen;
    }
    return a.id.localeCompare(b.id);
  });
}

/** RFC statuses that are not open, and so report no age. */
export function rfcTerminal(status: string | null): boolean {
  return status === "closed" || status === "superseded";
}
