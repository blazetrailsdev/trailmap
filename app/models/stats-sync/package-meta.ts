import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PackageMeta extends StatsSyncRecord {
  static {
    this.tableName = "package_meta";
  }
}
