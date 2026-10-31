import { StatsSyncRecord } from "./stats-sync-record.ts";

// The two advisory call summaries the --calls run prints. Whole-repo totals, so
// every row is package "all" — kept as a column anyway so these tables have the
// same shape as the other stats tables (and so a future per-package breakdown
// slots in without a migration).
export class ApiCallsStat extends StatsSyncRecord {
  static {
    this.tableName = "api_calls_stats";
    this.attribute("id", "big_integer");
    this.attribute("merge_commit_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("package", "string");
    this.attribute("matched", "integer");
    this.attribute("total", "integer");
    this.attribute("percent", "float");
    this.attribute("mismatched", "integer", { default: 0 });
  }
}
