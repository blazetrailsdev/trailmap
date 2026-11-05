import { Stats } from "./stats.ts";

/**
 * `package_tag_sites`, written by the stats sync from each merged commit's
 * `parity-outputs-<sha>` artifact (RFC 0222).
 *
 * @trails-typegen no-schema
 */
export class PackageTagSite extends Stats {
  static {
    this.tableName = "package_tag_sites";
  }
}
