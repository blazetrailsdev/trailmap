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
    this.attribute("changes", "integer");
    this.attribute("patch", "string");
  }
}
