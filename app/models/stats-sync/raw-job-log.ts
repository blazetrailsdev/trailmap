import { StatsSyncRecord } from "./stats-sync-record.ts";

export class RawJobLog extends StatsSyncRecord {
  static {
    this.tableName = "raw_job_logs";
    this.primaryKey = "job_id";
  }
}
