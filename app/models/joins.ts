import { Base } from "@blazetrails/activerecord";

/** Self-referential join: `story_id` depends on `depends_on_id`. */
export class StoryDep extends Base {
  static _tableName = "story_deps";
  declare story_id: string;
  declare depends_on_id: string;

  static {
    this.belongsTo("story", { foreignKey: "story_id" });
    this.belongsTo("dependsOn", { className: "Story", foreignKey: "depends_on_id" });
  }
}

/** A story may depend on a whole RFC closing. */
export class StoryRfcDep extends Base {
  static _tableName = "story_rfc_deps";
  declare story_id: string;
  declare rfc_id: string;

  static {
    this.belongsTo("story", { foreignKey: "story_id" });
    this.belongsTo("rfc", { foreignKey: "rfc_id" });
  }
}

/** Powers `tasks touching <path>`. */
export class StoryPath extends Base {
  static _tableName = "story_paths";
  declare story_id: string;
  declare path: string;

  static {
    this.belongsTo("story", { foreignKey: "story_id" });
  }
}

export class StoryPackage extends Base {
  static _tableName = "story_packages";
  declare story_id: string;
  declare package: string;

  static {
    this.belongsTo("story", { foreignKey: "story_id" });
  }
}
