import { ApplicationRecord } from "./application-record.js";
import { pinTimestampColumns } from "./timestamps.js";
import type { AssociationProxy, Relation } from "@blazetrails/activerecord";
import { closedRfcErrors } from "./concerns/semantic-validation.js";
import type { Story } from "./story.js";

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
  declare id: string; // slug, e.g. "0061-ci-failures"
  declare number: number | null;
  declare slug: string | null;
  declare title: string | null;
  declare status: RfcStatus;
  declare owner: string | null;
  declare superseded_by: string | null;
  declare priority: number | null;
  declare file_path: string | null;
  declare created_on: string | null;
  declare updated_on: string | null;
  declare packages: string[];
  declare clusters: string[];
  declare related_rfcs: string[];
  declare stories: AssociationProxy<Story>;

  declare isActive: () => boolean;
  declare static active: () => Relation<Rfc>;
  declare static closed: () => Relation<Rfc>;

  static {
    // Same trap as Story's `updated_on` — see the comment there. `created_on`
    // and `updated_on` are markdown's date-only `created:`/`updated:` fields;
    // `created_at`/`updated_at` are the real row timestamps (and NOT NULL), so
    // the touch has to keep those and let go of the other two.
    pinTimestampColumns(this, { create: ["created_at", "updated_at"], update: ["updated_at"] });

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
}
