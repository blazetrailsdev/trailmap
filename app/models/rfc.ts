import { Base } from "@blazetrails/activerecord";
import { pinTimestampColumns } from "./timestamps.js";
import type { AssociationProxy, Relation } from "@blazetrails/activerecord";
import type { Story } from "./story.js";

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
  }
}
