import { Migration } from "@blazetrails/activerecord";

/**
 * Each document's markdown, frontmatter stripped, so `/search` can match it in
 * SQL. Same version as the CLI's migration, which is the one that reaches the
 * live database: trailmap never migrates that one (config/database.ts).
 */
export class AddBodyToDocuments extends Migration.get(8) {
  async change() {
    await this.addColumn("stories", "body", "text");
    await this.addColumn("rfcs", "body", "text");
  }
}
