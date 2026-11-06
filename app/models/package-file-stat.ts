import { Stats } from "./stats.ts";

/**
 * `package_file_stats`, written by the stats sync from each merged commit's
 * `parity-outputs-<sha>` artifact (RFC 0222).
 *
 * @trails-typegen no-schema
 */
export class PackageFileStat extends Stats {
  static {
    this.tableName = "package_file_stats";
  }

  // The stats-sync cron owns this schema, so trails-tsc has none to read.
  declare merge_commit_sha: string;
  declare pr_number: number;
  declare package: string;
  declare rails_file: string;
  declare ts_file: string | null;
  declare methods_matched: number;
  declare methods_missing: number;
  declare tests_matched: number;
  declare tests_total: number;
}
