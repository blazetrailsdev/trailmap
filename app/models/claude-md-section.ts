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
}
