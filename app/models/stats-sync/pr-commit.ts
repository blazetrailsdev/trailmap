import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrCommit extends StatsSyncRecord {
  static {
    this.tableName = "pr_commits";
    this.attribute("id", "big_integer");
    this.attribute("pr_number", "integer");
    this.attribute("sha", "string");
    this.attribute("message", "string");
    this.attribute("author", "string");
    this.attribute("authored_at", "string");
  }
}
