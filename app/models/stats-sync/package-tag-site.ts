import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PackageTagSite extends StatsSyncRecord {
  static {
    this.tableName = "package_tag_sites";
  }
}
