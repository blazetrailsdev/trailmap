import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrTimelineEvent extends StatsSyncRecord {
  static {
    this.tableName = "pr_timeline_events";
  }
}
