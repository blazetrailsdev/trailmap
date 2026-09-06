import { Base } from "@blazetrails/activerecord";
import { pinTimestampColumns } from "./timestamps.js";
import type { AssociationProxy, Relation } from "@blazetrails/activerecord";
import { closedRfcErrors } from "./concerns/semantic-validation.js";
import type { Story } from "./story.js";

/**
 * A stored JSON array column (`packages`, `clusters`, `related_rfcs`), or `[]`
 * for null and for anything unparseable.
 *
 * `ingest` writes these as text, so every reader has to decode them, and every
 * reader has to agree — a second copy of this that tolerated one less shape
 * would make an RFC's packages depend on which page asked. It lives on the
 * model rather than in a serializer because the encoding is the column's, not
 * any one view's.
 */
export function jsonArrayColumn(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export const RFC_STATUSES = ["draft", "active", "closed", "postponed", "superseded"] as const;
export type RfcStatus = (typeof RFC_STATUSES)[number];

export class Rfc extends Base {
  static _tableName = "rfcs";

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
  declare packages: string | null; // JSON array
  declare clusters: string | null; // JSON array
  declare related_rfcs: string | null; // JSON array
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

    this.hasMany("stories", { foreignKey: "rfc_id" });
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
    this.validate(
      async (record) => {
        const rfc = record as unknown as Rfc;
        if (rfc.status !== "closed") return;
        const stories = await rfc.stories.toArray();
        for (const message of closedRfcErrors(rfc, stories)) rfc.errors.add("base", message);
      },
      { on: "ingest" },
    );
  }
}
