import { ApplicationRecord } from "./application-record.ts";

/**
 * Append-only. This is what replaced parsing 27k git commit subjects: the
 * velocity and RFC burndown charts read this table (via events.json), not
 * `git log`.
 */
export class Event extends ApplicationRecord {
  static {
    this.belongsTo("story", { optional: true });
    this.belongsTo("rfc", { optional: true });
  }
}
