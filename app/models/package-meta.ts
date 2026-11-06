import { Stats } from "./stats.ts";

/**
 * `package_meta`, written by the stats sync from each merged commit's
 * `parity-outputs-<sha>` artifact (RFC 0222).
 *
 * @trails-typegen no-schema
 */
export class PackageMeta extends Stats {
  static {
    this.tableName = "package_meta";
  }
}
