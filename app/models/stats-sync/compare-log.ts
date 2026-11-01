import { StatsSyncRecord } from "./stats-sync-record.ts";

export class CompareLog extends StatsSyncRecord {
  static {
    this.tableName = "compare_logs";
  }
}
