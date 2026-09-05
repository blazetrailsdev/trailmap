import { Migration } from "@blazetrails/activerecord";

export class CreateMeta extends Migration {
  async change() {
    // Single row per key. Holds `last_ingested_sha`, the watermark that makes
    // `tasks ingest` incremental (git diff <sha>..HEAD) rather than a 7k-file
    // rescan.
    await this.createTable("meta", { id: "string", primaryKey: "key" }, (t) => {
      t.text("value");
      t.timestamps();
    });
  }
}
