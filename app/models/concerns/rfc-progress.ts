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
import { effectiveStoryStatus } from "./effective-status.js";

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
 * The sort key an unprioritised story gets in ringo's index — its
 * `priorityUnset` (webhook/tasksdb.go:161), which sinks it below every
 * explicit priority instead of above them.
 */
const PRIORITY_UNSET = 1_000_000;

/**
 * `stories`, ordered for the page: status rank first, then ringo's INDEX
 * order — priority ascending with unset last, then id.
 *
 * ringo stable-sorts by status rank alone (`sort.SliceStable`,
 * webhook/rfcs.go:255), so what survives inside a status group is whatever
 * order its index was already in — and that index is itself sorted by
 * `(priority, id)` when it is loaded (webhook/tasksdb.go:287). A stable sort
 * over that pre-order is the same thing as a total sort by
 * `(rank, priority, id)`, which is what this does.
 *
 * Spelling the tiebreak out rather than leaning on a stable sort is not a
 * stylistic choice: the rows arrive here from `Story.where(...)`, whose order
 * is SQLite's rowid — the order the stories were ingested in — and stably
 * sorting THAT preserves an order ringo never had. `pnpm gate:pages` caught
 * exactly that, on every RFC in the database.
 *
 * `rfcStatus` is the parent RFC's, and it is required for the same reason the
 * ready queue needs it: ringo ranks the effective status (a `ready` story
 * under a non-active RFC is a `draft`, `effectiveStoryStatus`), so ordering
 * by the authored one floats work to the top of an RFC that cannot claim it.
 */
export function orderStoriesForRfc(
  stories: readonly Story[],
  rfcStatus: string | null,
): Story[] {
  // Ranked once per story rather than once per comparison: the largest RFC in
  // the database carries 1,434 stories, and a comparator that re-derives the
  // effective status does that work O(n log n) times for an answer that cannot
  // change.
  const rank = new Map(
    stories.map((story) => [
      story,
      storyStatusRank(effectiveStoryStatus(rfcStatus, story.status) ?? null),
    ]),
  );
  return [...stories].sort(
    (a, b) =>
      rank.get(a)! - rank.get(b)! ||
      (a.priority ?? PRIORITY_UNSET) - (b.priority ?? PRIORITY_UNSET) ||
      // Plain `<` rather than `localeCompare`: ringo compares Go strings, which
      // is a byte comparison, and a locale collation disagrees with that on
      // exactly the characters story ids are full of (`-` is ignorable in the
      // default collation, so `a-b` and `ab` reorder).
      compareBytes(a.id, b.id),
  );
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
 *
 * `rfcStatus` is required for the same reason `orderStoriesForRfc` requires
 * it: the bar is a row of status BADGES with a width, so the one status rule
 * (`app/views/shared/_status-badge`) applies to it — a `ready` story under a
 * draft RFC belongs in the draft segment, not the ready one, or the bar
 * advertises claimable work on an RFC whose stories nothing can claim. It is
 * the only place in `rfc-progress` where the override changes an answer:
 * `rfcStoryCounts` is invariant under it, because `ready` and `draft` are both
 * `open` there.
 */
export function storyStatusCounts(
  stories: readonly Story[],
  rfcStatus: string | null,
): StatusCount[] {
  const counts = new Map<string, number>();
  for (const story of stories) {
    const status = String(effectiveStoryStatus(rfcStatus, story.status) ?? "unknown");
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
 * The story count a full-length bar stands for: the 95th percentile of the
 * RFCs' story totals, empty RFCs left out — ringo's `percentileStories`
 * (`webhook/rfcs.go`, the `/rfcs` script).
 *
 * Two properties matter and they pull against each other. It must not change
 * when the tab does, or the same RFC looks bigger on one tab than another, so
 * it is taken over EVERY RFC and not the ones on show. And one freak RFC must
 * not squash the rest, so it is a percentile and not the maximum: the largest
 * RFC carries several times the stories of the next, and scaling to it leaves
 * the median RFC a stub. Anything above the reference is clamped, and says so.
 */
export function storyBarScale(totals: readonly number[]): number {
  const counted = totals.filter((t) => t > 0).sort((a, b) => a - b);
  if (counted.length === 0) return 0;
  return counted[Math.min(counted.length - 1, Math.floor(0.95 * counted.length))]!;
}

/** ringo's bar bounds in px: `SBAR_MIN_PX` and `SBAR_MAX_PX`. */
const STORY_BAR_MIN = 26;
const STORY_BAR_MAX = 400;

/** How long one RFC's bar is drawn. */
export interface StoryBarLength {
  /**
   * The bar's length as a percentage of its track, two places.
   *
   * ringo sets this in pixels, 26 to 400, which is why its list overflows a
   * phone: a 400px bar does not fit a 360px screen. The same number is given
   * here as a share of a track that is AT MOST 400px wide, so on a wide screen
   * the bar is the length ringo draws, and on a narrow one every bar shrinks
   * together and keeps its length relative to the others — which is all the
   * length was ever saying.
   */
  pct: number;
  /** More stories than the scale covers: full length for a different reason. */
  clamped: boolean;
}

/**
 * Map a story count onto a bar length — ringo's `barWidth`.
 *
 * Square root, not linear: story counts span three orders of magnitude, and a
 * linear scale renders everything under about forty stories as a sliver. The
 * floor keeps a one-story RFC a bar rather than a dot.
 */
export function storyBarLength(total: number, scale: number): StoryBarLength {
  const frac = scale > 0 ? Math.min(1, Math.sqrt(total) / Math.sqrt(scale)) : 1;
  const px = STORY_BAR_MIN + (STORY_BAR_MAX - STORY_BAR_MIN) * frac;
  return {
    pct: Math.round((10_000 * px) / STORY_BAR_MAX) / 100,
    clamped: scale > 0 && total > scale,
  };
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

/** Go's string comparison: byte order, not locale collation. */
function compareBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** RFC statuses that are not open, and so report no age. */
export function rfcTerminal(status: string | null): boolean {
  return status === "closed" || status === "superseded";
}
