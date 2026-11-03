import { ApplicationRecord } from "./application-record.ts";

/** Self-referential join: `story_id` depends on `depends_on_id`. */
export class StoryDep extends ApplicationRecord {
  static {
    this.belongsTo("story");
    this.belongsTo("dependsOn", { className: "Story" });
  }
}
