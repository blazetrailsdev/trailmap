import { Migration } from "@blazetrails/activerecord";

/**
 * One agent-written progress report, its file stored as the `report`
 * attachment. `name` is the filename agents wrote and the route key; `slug` is
 * that name without its extension; `written_at` the file's mtime to the
 * second, which is what the list is ordered by.
 */
export class CreateAudits extends Migration.get(8) {
  async change() {
    await this.createTable("audits", (t) => {
      t.string("repo", { null: false });
      t.string("name", { null: false });
      t.string("slug", { null: false });
      t.integer("size", { null: false });
      t.datetime("written_at", { null: false });
      t.timestamps();

      t.index(["name"], { unique: true });
      t.index(["written_at"]);
    });
  }
}
