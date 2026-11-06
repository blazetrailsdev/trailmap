import { Stats } from "./stats.ts";

/**
 * `package_skip_tests`, written by the stats sync from each merged commit's
 * `parity-outputs-<sha>` artifact (RFC 0222).
 *
 * @trails-typegen no-schema
 */
export class PackageSkipTest extends Stats {
  static {
    this.tableName = "package_skip_tests";
  }

  // The stats-sync cron owns this schema, so trails-tsc has none to read.
  declare merge_commit_sha: string;
  declare pr_number: number;
  declare package: string;
  declare file: string;
  declare test_name: string;
  declare cited_anchor: string | null;
}
