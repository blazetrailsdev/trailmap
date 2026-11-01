import { StatsSyncRecord } from "./stats-sync-record.ts";

export class ApiComparePrivatesStat extends StatsSyncRecord {
  static {
    this.tableName = "api_compare_privates_stats";
  }
}
