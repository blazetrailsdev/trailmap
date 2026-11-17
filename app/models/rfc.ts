import { ApplicationRecord } from "./application-record.ts";
import { closedRfcErrors } from "./concerns/semantic-validation.ts";
import { Event } from "./event.ts";
import { VerbExit } from "./verb-exit.ts";

/**
 * The coder of the JSON array columns (`packages`, `clusters`,
 * `related_rfcs`): `[]` for null and for anything unparseable.
 *
 * `ingest` writes these as text, and `coder: JSON, type: Array` raises on text
 * that is not a JSON array — as Rails' does — which would take a page down
 * over a column nothing renders. A coder is where Rails puts that tolerance.
 */
export const JsonArray = {
  load(value: string | null): string[] {
    if (!value) return [];
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  },
  dump: (value: string[]): string => JSON.stringify(value),
};

export const RFC_STATUSES = ["draft", "active", "closed", "postponed", "superseded"] as const;
export type RfcStatus = (typeof RFC_STATUSES)[number];

export class Rfc extends ApplicationRecord {
  // A custom attribute type's cast type is invisible to trails-tsc, which types
  // these from their text columns. Story: trails-tsc-type-custom-attribute-casts.
  declare packages: string[];
  declare clusters: string[];
  declare related_rfcs: string[];

  static {
    // Only `/search` reads it, in SQL; a loaded row should not carry 3 KB of markdown.
    this.ignoredColumns = ["body"];
    this.hasMany("stories");
    for (const column of ["packages", "clusters", "related_rfcs"]) {
      this.serialize(column, { coder: JsonArray });
    }
    this.enum("status", {
      draft: "draft",
      active: "active",
      closed: "closed",
      postponed: "postponed",
      superseded: "superseded",
    });

    // The RFC-lifecycle half of the semantic rules: a closed RFC may not hold
    // an unfinished story. Like Story's, it runs in the `ingest` context only —
    // the rule is about what the CONTENT asserts, and the auto-close rule
    // (rfc-close.ts) already maintains it on the mutation path.
    this.validate<Rfc>(
      async (rfc) => {
        if (rfc.status !== "closed") return;
        const stories = await rfc.stories.toArray();
        for (const message of closedRfcErrors(rfc, stories)) rfc.errors.add("base", message);
      },
      { on: "ingest" },
    );
  }

  /**
   * `created_on`/`updated_on` are markdown's date-only `created:`/`updated:`
   * fields; `created_at`/`updated_at` are the row timestamps. Hold both
   * touches to the latter — the create touch fills any nil timestamp column,
   * and an Rfc created without `created:` would get an instant there.
   */
  static override timestampAttributesForCreate(): string[] {
    return ["created_at"];
  }

  static override timestampAttributesForUpdate(): string[] {
    return ["updated_at"];
  }

  /**
   * `tasks rfc-priority <rfc> <n|clear>` (tasks/src/verbs.ts `setRfcPriority`):
   * the priority every story without its own inherits in the ready queue.
   * DB-owned, like a story's, so it is a row write and an `rfc-priority`
   * event — the CLI's `updateAll`, which touches no timestamp.
   */
  async prioritySet(priority: number | null): Promise<string> {
    if (priority !== null && (!Number.isInteger(priority) || priority < 0)) {
      throw new VerbExit(1, `priority must be a non-negative integer or "clear"`);
    }
    const label = priority === null ? "(clear)" : String(priority);
    await Rfc.transaction(async () => {
      await Rfc.where({ id: this.id }).updateAll({ priority });
      await Event.create({
        at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        verb: "rfc-priority",
        story_id: null,
        rfc_id: this.id,
        pr: null,
        actor: null,
        detail: JSON.stringify({ arg: label }),
      });
    });
    this.priority = priority;
    return `rfc-priority ${label}: ${this.id}`;
  }
}
