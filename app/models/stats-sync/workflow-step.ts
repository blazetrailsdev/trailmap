import { StatsSyncRecord } from "./stats-sync-record.ts";

export class WorkflowStep extends StatsSyncRecord {
  static {
    this.tableName = "workflow_steps";
    this.attribute("id", "big_integer");
    this.attribute("job_id", "big_integer");
    this.attribute("name", "string");
    this.attribute("status", "string");
    this.attribute("conclusion", "string");
    this.attribute("number", "integer");
    this.attribute("started_at", "string");
    this.attribute("completed_at", "string");
    this.attribute("duration_seconds", "integer");
  }
}
