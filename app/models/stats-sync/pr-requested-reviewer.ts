import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrRequestedReviewer extends StatsSyncRecord {
  static {
    this.tableName = "pr_requested_reviewers";
  }
}
