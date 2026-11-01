import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrCommit extends StatsSyncRecord {
  static {
    this.tableName = "pr_commits";
  }
}
