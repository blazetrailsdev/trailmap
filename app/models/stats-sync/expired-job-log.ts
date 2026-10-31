import { StatsSyncRecord } from "./stats-sync-record.ts";

export class ExpiredJobLog extends StatsSyncRecord {
  static {
    this.tableName = "expired_job_logs";
    this.primaryKey = "job_id";
    this.attribute("job_id", "big_integer");
    this.attribute("job_name", "string");
    this.attribute("pr_number", "integer");
    this.attribute("checked_at", "string");
  }
}
