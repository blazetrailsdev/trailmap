import { StatsSyncRecord } from "./stats-sync-record.ts";

export class TestCompareStat extends StatsSyncRecord {
  static {
    this.tableName = "test_compare_stats";
    this.attribute("id", "big_integer");
    this.attribute("merge_commit_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("package", "string");
    this.attribute("matched", "integer");
    this.attribute("total", "integer");
    this.attribute("percent", "float");
    this.attribute("skipped", "integer", { default: 0 });
    this.attribute("files_mapped", "integer", { default: 0 });
    this.attribute("files_total", "integer", { default: 0 });
    this.attribute("misplaced", "integer", { default: 0 });
    this.attribute("assertion_count_mismatch", "integer", { default: 0 });
    this.attribute("assertion_kind_mismatch", "integer", { default: 0 });
  }
}
