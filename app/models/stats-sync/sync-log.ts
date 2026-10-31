import { StatsSyncRecord } from "./stats-sync-record.ts";

export class SyncLog extends StatsSyncRecord {
  static {
    this.tableName = "sync_log";
    this.attribute("id", "big_integer");
    this.attribute("synced_at", "string");
    this.attribute("prs_synced", "integer", { default: 0 });
    this.attribute("runs_synced", "integer", { default: 0 });
    this.attribute("logs_parsed", "integer", { default: 0 });
  }
}
