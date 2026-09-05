import { Base } from "@blazetrails/activerecord";
import { pinTimestampColumns } from "./timestamps.js";
import type { AssociationProxy, Relation } from "@blazetrails/activerecord";
import type { Rfc } from "./rfc.js";
import type { StoryDep, StoryPackage, StoryPath, StoryRfcDep } from "./joins.js";
import type { Event } from "./event.js";
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
  // That is NOT the ready queue — see `claimable()` in src/ranking.ts, which
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
}
