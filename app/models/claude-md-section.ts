import { Stats } from "./stats.ts";

/**
 * `claude_md_sections`, written by the stats sync from each merged commit's
 * `parity-outputs-<sha>` artifact (RFC 0222).
 *
 * @trails-typegen no-schema
 */
export class ClaudeMdSection extends Stats {
  static {
    this.tableName = "claude_md_sections";
  }

  // The stats-sync cron owns this schema, so trails-tsc has none to read.
  declare merge_commit_sha: string;
  declare pr_number: number;
  declare file: string;
  declare heading: string;
  declare anchor: string;
  declare lede: string | null;
}
