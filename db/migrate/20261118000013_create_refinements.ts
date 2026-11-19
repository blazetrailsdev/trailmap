import { Migration } from "@blazetrails/activerecord";

/**
 * The refine reports (RFC 0243, Decision 1): the summary is an Active Storage
 * attachment, and `stories` is null for a report that never recorded it. Same
 * version as the CLI's migration, which is the one that reaches the live
 * database.
 */
export class CreateRefinements extends Migration.get(8) {
  async change() {
    await this.createTable("refinements", (t) => {
      t.string("rfc_id", { null: false });
      t.string("outcome", { null: false });
      t.integer("stories");
      t.timestamps();

      t.index(["rfc_id", "created_at"]);
    });
  }
}
