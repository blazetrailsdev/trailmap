/**
 * Which stories the backlog list shows under each tab, and in what order.
 *
 * Ported from ringo's backlog page (`webhook/backlog.go`), which does this in
 * the browser over `/spawnloop/backlog`. Porting it means the rules move from
 * a script to functions the tests can hold still — the tab predicates
 * especially, because the Draft/Icebox split is the one place where two tabs
 * partition a status between them and a drifting predicate would make a tab
 * advertise a count its own list does not hold.
 *
 * The ready-queue ORDER is deliberately not re-derived here: it is
 * `Story.claimable()`, the port `pnpm gate` proves byte-identical to the CLI's.
 * This module takes the queue as a list of ids and asks where a story sits in
 * it.
 */
import type { Story } from "../story.js";

/**
 * RFC states that put every story under them on ice. A draft RFC is an idea
 * not yet agreed; a postponed one is agreed and deliberately not now. Either
 * way nothing under it is up for picking, which is the only thing this list
 * decides. (`ICEBOX_RFC_STATUS`, webhook/backlog.go:164.)
 *
 * Note this is NOT `effectiveStoryStatus`'s rule, though the two rhyme: that
 * one downgrades a `ready` story under any non-active RFC and gates the queue.
 * This one is a display bucket over draft/postponed only, and a `ready` story
 * under a draft RFC still appears on the Ready tab, where the queue itself is
 * on display.
 */
export const ICEBOX_RFC_STATUSES: readonly string[] = ["draft", "postponed"];

export const BACKLOG_FILTERS = [
  "open",
  "done",
  "ready",
  "draft",
  "blocked",
  "icebox",
] as const;
export type BacklogFilter = (typeof BACKLOG_FILTERS)[number];

export function isBacklogFilter(value: string): value is BacklogFilter {
  return (BACKLOG_FILTERS as readonly string[]).includes(value);
}

/** Iced is judged by the PARENT RFC's status, never the story's own. */
export function iceboxed(story: Story, rfcStatus: ReadonlyMap<string, string>): boolean {
  return ICEBOX_RFC_STATUSES.includes(rfcStatus.get(story.rfc_id) ?? "");
}

/**
 * One tab's predicate, ported verbatim from `matchesFilter`.
 *
 * `open` is everything not done and not iced — the work that could actually be
 * picked. `icebox` is unfinished work only: a finished story does not become an
 * idea again because its RFC never got promoted. `draft` excludes the iced
 * ones, which is the partition that keeps the Draft tab workable; every other
 * tab matches its status exactly, so a READY story under a draft RFC is still
 * live work on the Ready tab rather than hidden.
 */
export function matchesBacklogFilter(
  story: Story,
  filter: BacklogFilter,
  rfcStatus: ReadonlyMap<string, string>,
): boolean {
  const iced = iceboxed(story, rfcStatus);
  if (filter === "icebox") return iced && story.status !== "done";
  if (filter === "open") return story.status !== "done" && !iced;
  if (filter === "done") return story.status === "done";
  if (filter === "draft") return story.status === "draft" && !iced;
  return story.status === filter;
}

/**
 * The list's status order — actionable first, done last. Distinct from the RFC
 * show page's `storyStatusRank`, which is ringo's OTHER order (`closed` sits
 * just above `done` there and has no arm at all): the two pages rank
 * differently in ringo, so folding them into one rank would change a page.
 */
const BACKLOG_STATUS_ORDER: readonly string[] = [
  "in-progress",
  "claimed",
  "ready",
  "blocked",
  "draft",
  "done",
];

/**
 * `stories` in list order: status group first, then — inside a group — the
 * ready queue in pick order, then everything else by id.
 *
 * A story the queue does not hold sorts after every story it does, which is
 * what makes "next up" and "#N" read down the page in the order an agent would
 * take them.
 */
export function orderBacklog(stories: readonly Story[], queuePos: ReadonlyMap<string, number>): Story[] {
  const rank = (story: Story) => {
    const at = BACKLOG_STATUS_ORDER.indexOf(String(story.status));
    return at < 0 ? 99 : at;
  };
  return [...stories].sort((a, b) => {
    const byStatus = rank(a) - rank(b);
    if (byStatus !== 0) return byStatus;
    const pa = queuePos.get(a.id);
    const pb = queuePos.get(b.id);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return a.id.localeCompare(b.id);
  });
}
