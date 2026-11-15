import { Migration } from "@blazetrails/activerecord";

/**
 * The stage an agent reports for its story (RFC 0232): `drafting` or `self`.
 * DB-owned and set only by `tasks stage`. Same version as the CLI's migration,
 * which is the one that reaches the live database: trailmap never migrates
 * that one (config/database.ts).
 */
export class AddStageToStories extends Migration.get(8) {
  async change() {
    await this.addColumn("stories", "stage", "string");
  }
}
