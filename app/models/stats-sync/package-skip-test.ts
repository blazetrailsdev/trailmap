import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PackageSkipTest extends StatsSyncRecord {
  static {
    this.tableName = "package_skip_tests";
  }
}
