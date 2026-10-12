import { ApplicationRecord } from "./application-record.js";

/** Self-referential join: `story_id` depends on `depends_on_id`. */
export class StoryDep extends ApplicationRecord {
  declare story_id: string;
  declare depends_on_id: string;

  static {
    this.belongsTo("story");
    this.belongsTo("dependsOn", { className: "Story" });
  }
}

/** A story may depend on a whole RFC closing. */
export class StoryRfcDep extends ApplicationRecord {
  declare story_id: string;
  declare rfc_id: string;

  static {
    this.belongsTo("story");
    this.belongsTo("rfc");
  }
}

/** Powers `tasks touching <path>`. */
export class StoryPath extends ApplicationRecord {
  declare story_id: string;
  declare path: string;

  static {
    this.belongsTo("story");
  }
}

export class StoryPackage extends ApplicationRecord {
  declare story_id: string;
  declare package: string;

  static {
    this.belongsTo("story");
  }
}
