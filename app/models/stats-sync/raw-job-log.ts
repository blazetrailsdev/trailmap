import { StatsSyncRecord } from "./stats-sync-record.ts";

export class RawJobLog extends StatsSyncRecord {
  static {
    this.tableName = "raw_job_logs";
    this.primaryKey = "job_id";
    this.attribute("job_id", "big_integer");
    this.attribute("run_id", "big_integer");
    this.attribute("job_name", "string");
    this.attribute("merge_commit_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("log_output", "text");
  }
}
