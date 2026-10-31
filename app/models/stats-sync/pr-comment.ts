import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrComment extends StatsSyncRecord {
  static {
    this.tableName = "pr_comments";
    // GitHub IDs exceed 2^31 — must be bigint, not 32-bit integer.
    this.attribute("id", "big_integer");
    this.attribute("pr_number", "integer");
    this.attribute("author", "string");
    this.attribute("body", "string");
    this.attribute("created_at", "string");
    this.attribute("updated_at", "string");
    this.attribute("comment_type", "string");
    this.attribute("path", "string");
    this.attribute("diff_hunk", "string");
    this.attribute("in_reply_to_id", "big_integer");
  }
}
