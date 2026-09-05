import { Base } from "@blazetrails/activerecord";
import { pinTimestampColumns } from "./timestamps.js";
import { Event } from "./event.js";
import { Rfc } from "./rfc.js";
import { StoryDep, StoryPath, StoryRfcDep } from "./joins.js";
import { VerbExit } from "./verb-exit.js";
import {
  bestBundle,
  claimableIn,
  comparePriority,
  emptyBundleReasonIn,
  listFilteredIn,
  nextBundleIn,
  priorityContext,
  storiesTouchingIn,
  summarizeBundle,
  type EmptyBundleReason,
  type RankingIndex,
} from "./concerns/ranking.js";
import type { AssociationProxy, Relation } from "@blazetrails/activerecord";
import type { StoryPackage } from "./joins.js";
import type { Temporal } from "@blazetrails/date";

export const STORY_STATUSES = [
  "draft",
  "ready",
  "claimed",
  "in-progress",
  "done",
  "blocked",
  "closed",
] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

/**
 * A dep is satisfied when it is `done` OR `closed`: a closed story will never
 * ship, but it will also never block — treating it as resolved is what keeps a
 * dependent from being stranded forever. (Ported from the old CLI's
 * isDepResolved; the semantics are load-bearing for the ready queue.)
 */
export const RESOLVED_DEP_STATUSES: readonly StoryStatus[] = ["done", "closed"];

export class Story extends Base {
  static _tableName = "stories";

  // ── markdown-owned: written only by `tasks ingest` ──
  declare id: string; // slug
  declare rfc_id: string;
  declare title: string | null;
  declare cluster: string | null;
  declare priority: number | null;
  declare est_loc: number | null;
  declare file_path: string | null;
  declare updated_on: string | null;

  // ── DB-owned: written only by the mutation verbs ──
  declare status: StoryStatus;
  declare pr: number | null;
  declare assignee: string | null;
  declare blocked_by: string | null;
  declare closed_reason: string | null;
  declare claim_at: Temporal.Instant | Temporal.PlainDateTime | null;
  declare updated_at: Temporal.Instant | Temporal.PlainDateTime;

  declare rfc: Rfc | null;
  declare storyDeps: AssociationProxy<StoryDep>;
  declare deps: AssociationProxy<Story>;
  declare storyRfcDeps: AssociationProxy<StoryRfcDep>;
  declare rfcDeps: AssociationProxy<Rfc>;
  declare paths: AssociationProxy<StoryPath>;
  declare packages: AssociationProxy<StoryPackage>;
  declare events: AssociationProxy<Event>;
  declare loadBelongsTo: (name: "rfc") => Promise<Rfc | null>;

  // NOTE: `enum` generates a static `Story.ready()` meaning `status='ready'`.
  // That is NOT the ready queue — see `Story.claimable()` below, which
  // additionally requires the RFC to be active and every dep resolved. Keep the
  // two names distinct; conflating them would hand agents unclaimable stories.
  declare static ready: () => Relation<Story>;
  declare static done: () => Relation<Story>;
  declare static claimed: () => Relation<Story>;
  declare isDone: () => boolean;
  declare isReady: () => boolean;

  static {
    // `updated_on` is a DATE-ONLY string ("2026-08-28"), markdown's `updated:`
    // field — but Rails' update-timestamp columns are BOTH `updated_at` and
    // `updated_on`, so a save stamps it with a full instant. It only skips a
    // column the save is already changing, and a verb writing today's date
    // onto a story already stamped today changes nothing — so the guard does
    // not fire and the column comes back as "2026-08-28T13:54:05.114Z".
    // readmodel's isoMidnight then builds "<that>T00:00:00.000Z", which is an
    // Invalid Date, and `next-bundle` dies for every caller. Restrict the
    // touch to the real timestamp column. (Assigning the resolved-columns
    // cache is the lever the library reads; the public static of the same name
    // is not consulted by its own internals.)
    pinTimestampColumns(this, { create: ["created_at", "updated_at"], update: ["updated_at"] });

    this.belongsTo("rfc", { foreignKey: "rfc_id" });
    this.hasMany("storyDeps", { foreignKey: "story_id", inverseOf: "story" });
    this.hasMany("deps", { through: "storyDeps", source: "dependsOn" });
    this.hasMany("storyRfcDeps", { foreignKey: "story_id" });
    this.hasMany("rfcDeps", { through: "storyRfcDeps", source: "rfc" });
    this.hasMany("paths", { className: "StoryPath", foreignKey: "story_id" });
    this.hasMany("packages", { className: "StoryPackage", foreignKey: "story_id" });
    this.hasMany("events", { foreignKey: "story_id" });
    // Labels are IDENTICAL to stored values, including the hyphen in
    // "in-progress". Rails' enum getter returns the LABEL, while raw SQL
    // returns the stored value — so a label of `inProgress` mapping to
    // "in-progress" makes `story.status` and `SELECT status` disagree, and
    // whichever one a given code path happens to use decides what it writes.
    // That shipped as `status: inProgress` into 21 story files before this
    // was caught. Identity mapping means there is nothing to translate.
    this.enum("status", {
      draft: "draft",
      ready: "ready",
      claimed: "claimed",
      "in-progress": "in-progress",
      done: "done",
      blocked: "blocked",
      closed: "closed",
    });
  }

  // ──────────────────── ready queue (ported from src/ranking.ts) ────────────────────

  /**
   * Everything the queue reads, one pass per table. The CLI ranked an
   * in-memory index.json; these tables are the index now. Association rows
   * become maps here, so ranking a backlog is five queries, not one per dep.
   */
  static async rankingIndex(): Promise<RankingIndex> {
    const [stories, rfcs, deps, rfcDeps, paths] = await Promise.all([
      Story.all().toArray(),
      Rfc.all().toArray(),
      StoryDep.all().toArray(),
      StoryRfcDep.all().toArray(),
      StoryPath.all().toArray(),
    ]);
    const group = <T>(rows: T[], key: (row: T) => string, value: (row: T) => string) => {
      const m = new Map<string, string[]>();
      for (const row of rows) {
        const bucket = m.get(key(row));
        if (bucket) bucket.push(value(row));
        else m.set(key(row), [value(row)]);
      }
      return m;
    };
    const rfcPriority = new Map<string, number>();
    for (const r of rfcs) if (typeof r.priority === "number") rfcPriority.set(r.id, r.priority);
    return {
      stories,
      rfcStatus: new Map(rfcs.map((r) => [r.id, r.status as string])),
      rfcPriority,
      deps: group(deps, (d) => d.story_id, (d) => d.depends_on_id),
      rfcDeps: group(rfcDeps, (d) => d.story_id, (d) => d.rfc_id),
      paths: group(paths, (p) => p.story_id, (p) => p.path),
    };
  }

  /**
   * The ready queue: `ready`, under an ACTIVE RFC, every dep resolved, ordered
   * by effective priority. Deliberately NOT `ready()` — that static is
   * enum-generated and means only `status = 'ready'`, a much weaker condition;
   * conflating the two would hand agents unclaimable stories.
   */
  static async claimable(opts: { rfc?: string } = {}): Promise<Story[]> {
    return claimableIn(await Story.rankingIndex(), opts);
  }

  /** Pack the highest-value bundle of claimable stories within `maxLoc`. */
  static async nextBundle(opts: {
    maxLoc: number;
    cluster?: string;
    rfc?: string;
  }): Promise<Story[]> {
    return nextBundleIn(await Story.rankingIndex(), opts);
  }

  /** Why `nextBundle` came back empty: nothing matched, or nothing fit. */
  static async emptyBundleReason(
    opts: { cluster?: string; rfc?: string } = {},
  ): Promise<EmptyBundleReason> {
    return emptyBundleReasonIn(await Story.rankingIndex(), opts);
  }

  static async listFiltered(
    opts: { rfc?: string; status?: string; cluster?: string } = {},
  ): Promise<Story[]> {
    return listFilteredIn(await Story.rankingIndex(), opts);
  }

  /** Stories whose body cites `query`, matched exact → directory → substring. */
  static async touching(query: string, opts: { all?: boolean } = {}): Promise<Story[]> {
    return storiesTouchingIn(await Story.rankingIndex(), query, opts);
  }

  // ──────────────────── mutations (ported from src/verbs.ts) ────────────────────

  /**
   * Claim, all-or-nothing across ids (ported rule): a bundle worker that
   * claims 3 of 5 and then aborts leaves the other 2 `claimed` with nobody
   * behind them — invisible to both the queue and the merge sweep. One taken
   * id refuses the lot. Re-claiming what we already hold is SUCCESS, not a
   * conflict: the loop re-runs `claim` after a client-side error.
   */
  static async claimAll(ids: string[], assignee: string): Promise<string[]> {
    let lines: string[] = [];
    await Base.transaction(async () => {
      const found = await Story.findAllOrThrow(ids);

      const taken = found.filter((s) => s.assignee !== null && s.assignee !== assignee);
      if (taken.length) {
        const verb = taken.length > 1 ? "are" : "is";
        throw new VerbExit(2, `${taken.map((s) => s.id).join(", ")} ${verb} already claimed`);
      }

      const available = found.filter((s) => s.status === "ready" && s.assignee === null);
      const at = nowIso();
      for (const s of available) {
        // The race resolution, and the one deliberate `updateAll`: the
        // affected-row count IS the answer. Zero rows means another agent got
        // there between our read and this write; nothing was written, so
        // there is nothing to roll back — we just report the loss.
        const affected = await Story.where({ id: s.id, status: "ready" }).updateAll({
          status: "claimed",
          assignee,
          claim_at: at,
          updated_on: today(),
        });
        if (affected === 0) {
          throw new VerbExit(3, `lost claim race on ${s.id} — pick another story`);
        }
        await s.recordEvent("claim", { actor: assignee });
      }
      // Nothing available means everything is already ours — idempotent repeat.
      lines = ids.map((id) => `claimed ${id} as ${assignee}`);
    });
    return lines;
  }

  static async releaseAll(ids: string[]): Promise<string[]> {
    const lines: string[] = [];
    await Base.transaction(async () => {
      const found = await Story.findAllOrThrow(ids);
      for (const s of found) {
        if (s.status !== "claimed") {
          throw new VerbExit(2, `${s.id} is ${s.status}, not claimed — nothing to release`);
        }
      }
      for (const s of found) lines.push(await s.release());
    });
    return lines;
  }

  /**
   * `in-progress` and `done`, both stamped with the PR. Best-effort PER ID,
   * unlike claim (ported rule): an id already at this exact status+pr is
   * skipped rather than aborting the rest, because a bundle whose PR merged
   * midway must be completable by re-running the same command.
   */
  static async markTrackingAll(
    ids: string[],
    status: Extract<StoryStatus, "in-progress" | "done">,
    pr: number | null,
  ): Promise<string[]> {
    const lines: string[] = [];
    await Base.transaction(async () => {
      const found = await Story.findAllOrThrow(ids);
      for (const s of found) lines.push(await s.markTracking(status, pr));
    });
    return lines;
  }

  /**
   * Append a `spawn` event recording WHERE a dispatch came from. Does NOT
   * touch story state — a spawn happened TO a story; the claim that follows is
   * the state change. An RFC-scoped dispatch names no story, so it is recorded
   * against `rfc_id` rather than dropped for want of a story id.
   */
  static async recordSpawn(
    ids: string[],
    source: string,
    opts: { branch?: string | null; pane?: string | null; rfc?: string | null } = {},
  ): Promise<string> {
    const detail = { source, branch: opts.branch ?? null, pane: opts.pane ?? null };
    if (opts.rfc && ids.length === 0) {
      await Event.create({
        at: nowIso(),
        verb: "spawn",
        story_id: null,
        rfc_id: opts.rfc,
        pr: null,
        actor: source,
        detail: JSON.stringify(detail),
      });
      return `recorded spawn (${source}) for rfc ${opts.rfc}`;
    }
    await Base.transaction(async () => {
      const found = await Story.findAllOrThrow(ids);
      for (const s of found) await s.recordEvent("spawn", { actor: source, detail });
    });
    return `recorded spawn (${source}) for ${ids.length} stor${ids.length === 1 ? "y" : "ies"}`;
  }

  static async findAllOrThrow(ids: string[]): Promise<Story[]> {
    const found = await Story.where({ id: ids }).toArray();
    const have = new Set(found.map((s) => s.id));
    const missing = ids.filter((id) => !have.has(id));
    if (missing.length) throw new VerbExit(1, `story not found: ${missing.join(", ")}`);
    return found;
  }

  /** Inverse of claim: claimed → ready, clearing the holder. */
  async release(): Promise<string> {
    await this.update({ status: "ready", ...clearedBy("ready"), updated_on: today() });
    await this.recordEvent("release");
    return `released ${this.id}`;
  }

  /**
   * `in-progress` self-claims when unclaimed: `/link` marks a story
   * in-progress without first claiming it, and validate's cross-field check
   * requires a claim timestamp AND an assignee there. Backfilling only fires
   * when `claim_at` is still null, so it never overwrites a real claim, and it
   * is folded into the skip check above so a repeat call stays a true no-op.
   */
  async markTracking(
    status: Extract<StoryStatus, "in-progress" | "done">,
    pr: number | null,
  ): Promise<string> {
    if (this.status === status && this.pr === pr && (status !== "in-progress" || this.claim_at !== null)) {
      return `${status} ${this.id} (already, skipped)`;
    }
    const selfClaim =
      status === "in-progress" && this.claim_at === null
        ? { claim_at: nowIso(), assignee: this.assignee ?? this.id }
        : {};
    await this.update({ status, pr, ...clearedBy(status), ...selfClaim, updated_on: today() });
    await this.recordEvent(status, { pr });
    return `${status} ${this.id}${pr === null ? "" : ` #${pr}`}`;
  }

  async block(reason: string): Promise<string> {
    await this.update({
      status: "blocked",
      ...clearedBy("blocked"),
      blocked_by: reason,
      updated_on: today(),
    });
    await this.recordEvent("block", { detail: { note: reason } });
    return `blocked ${this.id}`;
  }

  /**
   * Close with a required reason. The reason is not decoration: a closed story
   * is how work gets abandoned, and this note is the only record of WHY. It is
   * carried into `events` as well as the row, so it survives the story file.
   */
  async close(reason: string): Promise<string> {
    if (!reason.trim()) throw new VerbExit(1, "close requires a reason");
    // An idempotent repeat is a no-op: re-closing with the SAME reason would
    // otherwise append a second `close` event that the velocity chart reads as
    // a second abandonment. A different reason is a real correction and still
    // writes.
    if (this.status === "closed" && this.closed_reason === reason) {
      return `closed ${this.id} (already, skipped)`;
    }
    await this.update({
      status: "closed",
      ...clearedBy("closed"),
      closed_reason: reason,
      updated_on: today(),
    });
    await this.recordEvent("close", { detail: { note: reason } });
    return `closed ${this.id}`;
  }

  /** Set status directly, clearing whatever the old status owned. */
  async statusSet(status: StoryStatus): Promise<string> {
    await this.update({ status, ...clearedBy(status), updated_on: today() });
    await this.recordEvent("status", { detail: { arg: status } });
    return `status ${status}: ${this.id}`;
  }

  async setPriority(priority: number | null): Promise<string> {
    await this.update({ priority, updated_on: today() });
    await this.recordEvent("priority", {
      detail: { arg: priority === null ? "(clear)" : String(priority) },
    });
    return `priority ${priority === null ? "(clear)" : priority}: ${this.id}`;
  }

  /**
   * Every mutation writes one of these. The log is the intended replacement
   * for parsing the tasks git log as an event stream, so the write is part of
   * the contract, not an incidental.
   */
  async recordEvent(
    verb: string,
    extra: { pr?: number | null; actor?: string | null; detail?: unknown } = {},
  ): Promise<void> {
    await Event.create({
      at: nowIso(),
      verb,
      story_id: this.id,
      rfc_id: null,
      pr: extra.pr ?? null,
      actor: extra.actor ?? null,
      detail: extra.detail == null ? null : JSON.stringify(extra.detail),
    });
  }
}

/** ISO seconds, matching the `claim:` format the CLI writes. */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

/** Day granularity, matching markdown's date-only `updated:` field. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The fields the OLD status owned that the NEW one invalidates. Leaving them
 * behind produces a row that contradicts itself: a story moved off `blocked`
 * that kept its `blocked_by` told the next agent the work could not be done
 * (six spawns bounced off one such story), a stale `claim`/`assignee`/`pr` on
 * `ready` reads as "someone else owns this", and a `closed_reason` on a `done`
 * story claims shipped work was abandoned. Shared by every verb that moves
 * status, because each one clearing its own subset left a different half-
 * cleared row behind.
 */
function clearedBy(status: StoryStatus): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (status !== "blocked") fields.blocked_by = null;
  if (status !== "closed") fields.closed_reason = null;
  if (status === "ready" || status === "draft") {
    fields.assignee = null;
    fields.claim_at = null;
    fields.pr = null;
  }
  return fields;
}

export { bestBundle, comparePriority, priorityContext, summarizeBundle };
export type { EmptyBundleReason, RankingIndex };
