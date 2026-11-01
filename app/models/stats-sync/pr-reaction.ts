import { StatsSyncRecord } from "./stats-sync-record.ts";

// Retained for the reactions sync #2433 removed: the pr_reactions table is still
// created and counted, and this is its only typed accessor.
// eslint-disable-next-line unused-imports/no-unused-vars
export class PrReaction extends StatsSyncRecord {
  static {
    this.tableName = "pr_reactions";
    this.primaryKey = "reaction_id";
  }
}
