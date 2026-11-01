import { StatsSyncRecord } from "./stats-sync-record.ts";

export class SyncLog extends StatsSyncRecord {
  static {
    this.tableName = "sync_log";
  }
}
