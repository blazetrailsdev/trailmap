import { StatsSyncRecord } from "./stats-sync-record.ts";

// The two advisory call summaries the --calls run prints. Whole-repo totals, so
// every row is package "all" — kept as a column anyway so these tables have the
// same shape as the other stats tables (and so a future per-package breakdown
// slots in without a migration).
export class ApiCallsStat extends StatsSyncRecord {
  static {
    this.tableName = "api_calls_stats";
  }
}
