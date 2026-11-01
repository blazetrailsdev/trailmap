import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrFile extends StatsSyncRecord {
  static {
    this.tableName = "pr_files";
  }
}
