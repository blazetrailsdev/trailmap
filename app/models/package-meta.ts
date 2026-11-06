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

  // The stats-sync cron owns this schema, so trails-tsc has none to read.
  // Story: trails-tsc-type-models-on-unowned-schema.
  declare merge_commit_sha: string;
  declare pr_number: number;
  declare package: string;
  /** The Rails gem this package ports; null for a trails-only package. */
  declare rails_counterpart: string | null;
}
