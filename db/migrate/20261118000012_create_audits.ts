import { Migration } from "@blazetrails/activerecord";

/**
 * The audit reports (RFC 0243): the body is an Active Storage attachment, and
 * `(repo, slug, written_at)` is the import's idempotency key. Same version as
 * the CLI's migration, which is the one that reaches the live database.
 */
export class CreateAudits extends Migration.get(8) {
  async change() {
    await this.createTable("audits", (t) => {
      t.string("slug", { null: false });
      t.string("title");
      t.string("format");
      t.string("repo");
      t.datetime("written_at", { null: false });
      t.timestamps();

      t.index(["repo", "slug", "written_at"], { unique: true });
    });
  }
}
