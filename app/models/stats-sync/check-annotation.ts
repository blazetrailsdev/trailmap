import { StatsSyncRecord } from "./stats-sync-record.ts";

export class CheckAnnotation extends StatsSyncRecord {
  static {
    this.tableName = "check_annotations";
    this.attribute("id", "big_integer");
    this.attribute("run_id", "big_integer");
    this.attribute("job_id", "big_integer");
    this.attribute("path", "string");
    this.attribute("start_line", "integer");
    this.attribute("end_line", "integer");
    this.attribute("annotation_level", "string");
    this.attribute("message", "string");
    this.attribute("title", "string");
  }
}
