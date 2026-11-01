import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PullRequest extends StatsSyncRecord {
  static {
    this.tableName = "pull_requests";
    this.primaryKey = "number";
  }
}
