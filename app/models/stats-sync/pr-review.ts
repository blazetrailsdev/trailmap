import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrReview extends StatsSyncRecord {
  static {
    this.tableName = "pr_reviews";
  }
}
