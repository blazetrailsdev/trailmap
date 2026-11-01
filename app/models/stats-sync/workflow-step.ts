import { StatsSyncRecord } from "./stats-sync-record.ts";

export class WorkflowStep extends StatsSyncRecord {
  static {
    this.tableName = "workflow_steps";
  }
}
