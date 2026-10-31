import { StatsSyncRecord } from "./stats-sync-record.ts";

export class WorkflowJob extends StatsSyncRecord {
  static {
    this.tableName = "workflow_jobs";
    this.attribute("id", "big_integer");
    this.attribute("run_id", "big_integer");
    this.attribute("name", "string");
    this.attribute("status", "string");
    this.attribute("conclusion", "string");
    this.attribute("started_at", "string");
    this.attribute("completed_at", "string");
    this.attribute("duration_seconds", "integer");
  }
}
