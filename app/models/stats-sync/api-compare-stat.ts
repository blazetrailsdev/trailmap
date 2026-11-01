import { StatsSyncRecord } from "./stats-sync-record.ts";

export class ApiCompareStat extends StatsSyncRecord {
  static {
    this.tableName = "api_compare_stats";
  }
}
