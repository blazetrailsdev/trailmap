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
}
