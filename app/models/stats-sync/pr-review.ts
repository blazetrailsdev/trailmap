import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrReview extends StatsSyncRecord {
  static {
    this.tableName = "pr_reviews";
    this.attribute("id", "big_integer");
    this.attribute("pr_number", "integer");
    this.attribute("author", "string");
    this.attribute("state", "string");
    this.attribute("body", "string");
    this.attribute("submitted_at", "string");
    this.attribute("source", "string");
    this.attribute("source_path", "string");
  }
}
