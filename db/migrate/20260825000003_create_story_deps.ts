import { Migration } from "@blazetrails/activerecord";

export class CreateStoryDeps extends Migration {
  async change() {
    // Self-referential join: story_id depends on depends_on_id. This is the
    // dep graph the ready-queue walks.
    await this.createTable("story_deps", { id: false }, (t) => {
      t.string("story_id", { null: false });
      t.string("depends_on_id", { null: false });
      t.index(["story_id"]);
      t.index(["depends_on_id"]);
      t.index(["story_id", "depends_on_id"], { unique: true });
    });

    // A story may also depend on a whole RFC closing.
    await this.createTable("story_rfc_deps", { id: false }, (t) => {
      t.string("story_id", { null: false });
      t.string("rfc_id", { null: false });
      t.index(["story_id"]);
      t.index(["story_id", "rfc_id"], { unique: true });
    });

    // Powers `tasks touching <path>`: which open stories cite a trails path.
    await this.createTable("story_paths", { id: false }, (t) => {
      t.string("story_id", { null: false });
      t.string("path", { null: false });
      t.index(["story_id"]);
      t.index(["path"]);
    });

    // The `packages:` frontmatter list.
    await this.createTable("story_packages", { id: false }, (t) => {
      t.string("story_id", { null: false });
      t.string("package", { null: false });
      t.index(["story_id"]);
      t.index(["package"]);
    });
  }
}
