import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrComment extends StatsSyncRecord {
  static {
    this.tableName = "pr_comments";
  }
}
