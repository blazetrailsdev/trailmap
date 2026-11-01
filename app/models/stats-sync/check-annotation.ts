import { StatsSyncRecord } from "./stats-sync-record.ts";

export class CheckAnnotation extends StatsSyncRecord {
  static {
    this.tableName = "check_annotations";
  }
}
