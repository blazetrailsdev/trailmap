import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PackageMarkStat extends StatsSyncRecord {
  static {
    this.tableName = "package_mark_stats";
  }
}
