import { StatsSyncRecord } from "./stats-sync-record.ts";

export class TestCompareStat extends StatsSyncRecord {
  static {
    this.tableName = "test_compare_stats";
  }
}
