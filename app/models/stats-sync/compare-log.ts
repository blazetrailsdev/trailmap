import { StatsSyncRecord } from "./stats-sync-record.ts";

export class CompareLog extends StatsSyncRecord {
  static {
    this.tableName = "compare_logs";
    this.attribute("id", "big_integer");
    this.attribute("merge_commit_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("step_name", "string");
    this.attribute("log_output", "string");
  }
}
