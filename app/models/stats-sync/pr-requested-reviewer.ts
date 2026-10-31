import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrRequestedReviewer extends StatsSyncRecord {
  static {
    this.tableName = "pr_requested_reviewers";
    this.attribute("id", "big_integer");
    this.attribute("pr_number", "integer");
    this.attribute("reviewer", "string");
    this.attribute("reviewer_type", "string");
  }
}
