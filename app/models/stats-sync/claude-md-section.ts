import { StatsSyncRecord } from "./stats-sync-record.ts";

export class ClaudeMdSection extends StatsSyncRecord {
  static {
    this.tableName = "claude_md_sections";
  }
}
