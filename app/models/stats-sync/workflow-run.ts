import { StatsSyncRecord } from "./stats-sync-record.ts";

export class WorkflowRun extends StatsSyncRecord {
  static {
    this.tableName = "workflow_runs";
  }
}
