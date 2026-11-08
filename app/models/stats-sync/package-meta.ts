import { compareKeys } from "../concerns/compare-keys.ts";
import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PackageMeta extends StatsSyncRecord {
  static {
    this.tableName = "package_meta";
    this.prototype.compareKeys = compareKeys;
  }

  declare merge_commit_sha: string;
  declare pr_number: number;
  declare package: string;
  declare rails_counterpart: string | null;
  declare description: string | null;
  declare compare_keys: string | null;
  /** The api:compare and test:compare keys this package's rows are written under. */
  declare compareKeys: typeof compareKeys;
}
