import { Stats } from "./stats.ts";

/**
 * `package_tag_stats`, written by the stats sync from each merged commit's
 * `parity-outputs-<sha>` artifact (RFC 0222).
 *
 * @trails-typegen no-schema
 */
export class PackageTagStat extends Stats {
  static {
    this.tableName = "package_tag_stats";
  }

  // The stats-sync cron owns this schema, so trails-tsc has none to read.
  declare merge_commit_sha: string;
  declare pr_number: number;
  declare package: string;
  declare tag: string;
  declare receipt: string | null;
  declare count: number;
}
