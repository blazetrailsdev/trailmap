import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PrFile extends StatsSyncRecord {
  static {
    this.tableName = "pr_files";
  }

  // GitHub's `changes` column collides with ActiveModel::Dirty#changes, which
  // raises DangerousAttributeError. This is Rails' escape hatch: answering
  // true leaves the column readable through readAttribute with no reader.
  static isInstanceMethodAlreadyImplemented(methodName: string): boolean {
    return methodName === "changes" || super.isInstanceMethodAlreadyImplemented(methodName);
  }
}
