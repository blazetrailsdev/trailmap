import { ApplicationRecord } from "./application-record.ts";

/** A story may depend on a whole RFC closing. */
export class StoryRfcDep extends ApplicationRecord {
  static {
    this.belongsTo("story");
    this.belongsTo("rfc");
  }
}
