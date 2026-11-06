import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PackageFileStat extends StatsSyncRecord {
  static {
    this.tableName = "package_file_stats";
  }
}
