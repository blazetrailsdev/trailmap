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

  // The stats-sync cron owns this schema, so trails-tsc has none to read.
  declare merge_commit_sha: string;
  declare pr_number: number;
  declare package: string;
  declare tag: string;
  declare receipt: string | null;
  declare file: string;
  declare line: number;
  declare declaration: string | null;
  declare cited_anchor: string | null;
}
