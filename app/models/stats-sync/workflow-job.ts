import { StatsSyncRecord } from "./stats-sync-record.ts";

export class WorkflowJob extends StatsSyncRecord {
  static {
    this.tableName = "workflow_jobs";
  }
}
