import { ApplicationRecord } from "./application-record.ts";

/** Powers `tasks touching <path>`. */
export class StoryPath extends ApplicationRecord {
  static {
    this.belongsTo("story");
  }
}
