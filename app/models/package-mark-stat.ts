import { Stats } from "./stats.ts";

/**
 * `package_mark_stats`, written by the stats sync from each merged commit's
 * `parity-outputs-<sha>` artifact (RFC 0222).
 *
 * @trails-typegen no-schema
 */
export class PackageMarkStat extends Stats {
  static {
    this.tableName = "package_mark_stats";
  }

  // The stats-sync cron owns this schema, so trails-tsc has none to read.
  declare merge_commit_sha: string;
  declare pr_number: number;
  declare package: string;
  declare mark: string;
  declare value: number | null;
  declare matched: number | null;
  declare total: number | null;
}
