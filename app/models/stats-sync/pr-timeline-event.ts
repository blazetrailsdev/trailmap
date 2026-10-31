import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrTimelineEvent extends StatsSyncRecord {
  static {
    this.tableName = "pr_timeline_events";
    this.attribute("id", "big_integer");
    this.attribute("pr_number", "integer");
    this.attribute("event_type", "string");
    this.attribute("actor", "string");
    this.attribute("created_at", "string");
    this.attribute("label_name", "string");
    this.attribute("body", "string");
  }
}
