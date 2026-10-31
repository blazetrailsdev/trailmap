import { statsSyncDatabaseConfig } from "../../../config/database.ts";
import { ApplicationRecord } from "../application-record.ts";

/**
 * The base class of what the stats sync writes. It is not `Stats`: that
 * connection is read-only and its models read what this sync wrote, so the
 * writers have their own, on STATS_SYNC_DB, which is why `pull-request.ts` here
 * and in app/models are different classes.
 *
 * Connecting here, at import, is what lets the models beside it declare
 * attributes as they load. It opens no file until something queries.
 */
export class StatsSyncRecord extends ApplicationRecord {
  static {
    this.abstractClass = true;
  }
}

await StatsSyncRecord.establishConnection(statsSyncDatabaseConfig());
