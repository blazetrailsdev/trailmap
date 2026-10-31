import { StatsSyncRecord } from "./stats-sync-record.ts";

export class ApiCompareStat extends StatsSyncRecord {
  static {
    this.tableName = "api_compare_stats";
    this.attribute("id", "big_integer");
    this.attribute("merge_commit_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("package", "string");
    this.attribute("matched", "integer");
    this.attribute("total", "integer");
    this.attribute("percent", "float");
    this.attribute("misplaced", "integer", { default: 0 });
    this.attribute("missing", "integer", { default: 0 });
  }
}
