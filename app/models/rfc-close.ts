/**
 * Auto-close an RFC when its last story lands.
 *
 * An RFC with nothing left to do stayed `active` until a human noticed and
 * opened a PR flipping its frontmatter. Until then it kept showing up in the
 * spawn loop's active set and on the RFC page as live work, and `ready`
 * queried it every pass for stories that no longer existed.
 *
 * The rule is an `afterSave` declared in Story's body, not bolted onto
 * each verb: every path that lands a story — `done`, `close`, `status`, and
 * ingest closing a story whose file was deleted — goes through a record save,
 * so all four get the close for free and none of them can forget it. That is
 * also why the mutation verbs save the loaded record instead of calling
 * `Relation#updateAll`: update_all skips callbacks, so a verb written that way
 * is invisible to this rule.
 *
 * Counts through `rfc.stories` rather than importing `Story`, which imports
 * this file to declare the callback.
 */
import { Trails } from "@blazetrails/trailties";
import { Event } from "./event.ts";
import { Rfc } from "./rfc.ts";
import type { StoryStatus } from "./story.ts";

/**
 * RFCs that must NEVER auto-close, even with an all-terminal backlog.
 *
 * The CI-failures RFC is a permanent home for fixer stories: btwhooks files a
 * fresh `ready` story under it every time main goes red, so it has to be
 * `active` at all times. Closing it makes the very next fixer story fail
 * validation ("closed RFC has a non-terminal story"), the CLI refuses to file
 * it, and the CI fixer silently wedges — this is what happened on 2026-07-29.
 * Kept in lockstep with the same set in scripts/auto-close.mjs and with
 * btwhooks' CI_FAILURES_RFC.
 */
const NEVER_AUTO_CLOSE = new Set(["0061-ci-failures"]);

/** A story in one of these is finished with — it will never move again. */
const TERMINAL: readonly StoryStatus[] = ["done", "closed"];

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

/**
 * Close `rfcId` if it is active and every one of its stories is terminal.
 *
 * An RFC with NO stories is left alone: that is a freshly written RFC whose
 * backlog has not been authored yet, not a finished one. Closing those would
 * take every new RFC out of the ready queue the moment it was ingested.
 *
 * Returns whether it closed anything, so callers can report it.
 */
export async function closeRfcIfComplete(rfcId: string | null | undefined): Promise<boolean> {
  if (!rfcId || NEVER_AUTO_CLOSE.has(rfcId)) return false;
  const rfc = await Rfc.findBy({ id: rfcId });
  if (!rfc || rfc.status !== "active") return false;

  // `count()` widens to `number | Map` for grouped relations; these are not
  // grouped, so the narrowing is safe.
  const total = (await rfc.stories.count()) as number;
  if (total === 0) return false;
  const open = (await rfc.stories.where().not({ status: TERMINAL }).count()) as number;
  if (open > 0) return false;

  await rfc.update({ status: "closed", updated_on: new Date().toISOString().slice(0, 10) });
  await Event.create({
    at: nowIso(),
    verb: "rfc-close",
    story_id: null,
    rfc_id: rfcId,
    pr: null,
    actor: "auto",
    detail: JSON.stringify({ reason: "all stories done or closed", stories: total }),
  });
  Trails.logger?.info(`closed rfc ${rfcId} — all ${total} stories are done or closed`);
  return true;
}
