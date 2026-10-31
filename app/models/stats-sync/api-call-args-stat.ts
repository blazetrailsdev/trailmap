import { StatsSyncRecord } from "./stats-sync-record.ts";

export class ApiCallArgsStat extends StatsSyncRecord {
  static {
    this.tableName = "api_call_args_stats";
    this.attribute("id", "big_integer");
    this.attribute("merge_commit_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("package", "string");
    this.attribute("matched", "integer");
    this.attribute("total", "integer");
    this.attribute("percent", "float");
    this.attribute("mismatched", "integer", { default: 0 });
  }
}
