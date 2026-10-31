import { StatsSyncRecord } from "./stats-sync-record.ts";

export class WorkflowRun extends StatsSyncRecord {
  static {
    this.tableName = "workflow_runs";
    this.attribute("id", "big_integer");
    this.attribute("head_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("event", "string");
    this.attribute("status", "string");
    this.attribute("conclusion", "string");
    this.attribute("created_at", "string");
    this.attribute("updated_at", "string");
    this.attribute("run_started_at", "string");
    this.attribute("duration_seconds", "integer");
    this.attribute("workflow_name", "string");
    this.attribute("run_attempt", "integer");
  }
}
