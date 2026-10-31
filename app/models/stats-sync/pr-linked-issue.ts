import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrLinkedIssue extends StatsSyncRecord {
  static {
    this.tableName = "pr_linked_issues";
    this.attribute("id", "big_integer");
    this.attribute("pr_number", "integer");
    this.attribute("issue_number", "integer");
    this.attribute("issue_title", "string");
    this.attribute("issue_state", "string");
  }
}
