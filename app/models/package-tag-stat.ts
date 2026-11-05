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
}
