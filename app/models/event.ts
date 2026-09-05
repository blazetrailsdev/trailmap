import { Base } from "@blazetrails/activerecord";
import type { Temporal } from "@blazetrails/date";

/**
 * Append-only. This is what replaced parsing 27k git commit subjects: the
 * velocity and RFC burndown charts read this table (via events.json), not
 * `git log`.
 */
export class Event extends Base {
  static _tableName = "events";

  declare id: number;
  declare at: Temporal.Instant | Temporal.PlainDateTime;
  declare verb: string;
  declare story_id: string | null;
  declare rfc_id: string | null;
  declare pr: number | null;
  declare actor: string | null;
  declare detail: string | null;

  static {
    this.belongsTo("story", { foreignKey: "story_id", optional: true });
    this.belongsTo("rfc", { foreignKey: "rfc_id", optional: true });
  }
}
