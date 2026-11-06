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
}
