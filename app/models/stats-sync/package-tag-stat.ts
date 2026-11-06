import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PackageTagStat extends StatsSyncRecord {
  static {
    this.tableName = "package_tag_stats";
  }
}
