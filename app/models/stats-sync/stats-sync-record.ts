import { ApplicationRecord } from "../application-record.ts";

/**
 * The base class of what the stats sync writes. It is not `Stats`: that
 * connection is read-only and its models read what this sync wrote, so the
 * writers have their own, on STATS_SYNC_DB, which is why `pull-request.ts` here
 * and in app/models are different classes.
 *
 * config/initializers/stats-sync-database.ts connects it.
 */
export class StatsSyncRecord extends ApplicationRecord {
  static {
    this.abstractClass = true;
  }
}
