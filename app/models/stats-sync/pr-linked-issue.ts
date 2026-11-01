import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrLinkedIssue extends StatsSyncRecord {
  static {
    this.tableName = "pr_linked_issues";
  }
}
