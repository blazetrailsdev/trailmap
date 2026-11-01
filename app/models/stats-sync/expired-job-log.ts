import { StatsSyncRecord } from "./stats-sync-record.ts";

export class ExpiredJobLog extends StatsSyncRecord {
  static {
    this.tableName = "expired_job_logs";
    this.primaryKey = "job_id";
  }
}
