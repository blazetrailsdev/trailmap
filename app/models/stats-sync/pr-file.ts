import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrFile extends StatsSyncRecord {
  static {
    this.tableName = "pr_files";
    this.attribute("id", "big_integer");
    this.attribute("pr_number", "integer");
    this.attribute("filename", "string");
    this.attribute("status", "string");
    this.attribute("additions", "integer");
    this.attribute("deletions", "integer");
    // The `changes` column has no attribute: it would shadow Base#changes, which
    // Rails refuses as a dangerous attribute. upsertAll writes it from the schema.
    this.attribute("patch", "string");
  }
}
