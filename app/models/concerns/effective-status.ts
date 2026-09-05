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
