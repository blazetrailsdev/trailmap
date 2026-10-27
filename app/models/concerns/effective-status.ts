/**
 * The parent-RFC status override — ONE definition, here.
 *
 * A `ready` story under a draft/postponed/superseded/closed (or unknown) RFC
 * must never surface as claimable to ANY consumer: the spawn loop, the backlog
 * dashboard, `tasks list`, or this application. Only `ready` downgrades —
 * in-flight and terminal statuses (claimed, in-progress, done, blocked, closed)
 * record facts, not claimability, and pass through as authored. `draft` is the
 * target because it is the existing pre-work, not-claimable queue state:
 * reactivating the RFC restores `ready` with no story-file edit.
 *
 * This is a SEMANTIC rule — it is about what a status MEANS relative to another
 * record — which is why it belongs on the models rather than in the content
 * repo's lint scripts, where `src/readmodel.ts` used to import it from. The
 * ready queue reads it through `claimableIn` rather than re-deriving "is the
 * RFC active?", so the queue and the published index cannot disagree.
 */
export function effectiveStoryStatus(
  rfcStatus: string | null | undefined,
  storyStatus: string | null | undefined,
): string | null | undefined {
  if (storyStatus === "ready" && rfcStatus !== "active") return "draft";
  return storyStatus;
}

/**
 * The status a page SHOWS — ringo's `markDepBlocked` (webhook/depblocked.go)
 * over the effective status: a story still `ready` after the RFC override
 * that the queue holds back on an unfinished dep (a story neither done nor
 * closed, or an RFC not closed) reads as `blocked`.
 *
 * DISPLAY ONLY. The authored status stays `ready`, so the story unblocks
 * itself when its last dep lands, and nothing that decides claimability —
 * the queue, `list --status`, the JSON verbs — may read this. `depHeld` comes
 * from `depHeldIn` (an index in hand) or `Story.depHeldIds` (a query).
 */
export function shownStoryStatus(
  rfcStatus: string | null | undefined,
  storyStatus: string | null | undefined,
  depHeld: boolean,
): string | null | undefined {
  const effective = effectiveStoryStatus(rfcStatus, storyStatus);
  return effective === "ready" && depHeld ? "blocked" : effective;
}
