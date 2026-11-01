import { StatsSyncRecord } from "./stats-sync-record.ts";

export class ApiCallArgsStat extends StatsSyncRecord {
  static {
    this.tableName = "api_call_args_stats";
  }
}
