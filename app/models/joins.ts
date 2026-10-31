import { ApplicationRecord } from "./application-record.ts";
import type { Story } from "./story.ts";

/** Self-referential join: `story_id` depends on `depends_on_id`. */
export class StoryDep extends ApplicationRecord {
  static {
    this.belongsTo("story");
    this.belongsTo("dependsOn", { className: "Story" });
  }
}

/** A story may depend on a whole RFC closing. */
export class StoryRfcDep extends ApplicationRecord {
  static {
    this.belongsTo("story");
    this.belongsTo("rfc");
  }
}

/** Powers `tasks touching <path>`. */
export class StoryPath extends ApplicationRecord {
  static {
    this.belongsTo("story");
  }
}

export class StoryPackage extends ApplicationRecord {
  static {
    this.belongsTo("story");
  }
}
