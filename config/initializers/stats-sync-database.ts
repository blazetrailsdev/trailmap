import { statsSyncDatabaseConfig } from "../database.ts";
import { StatsSyncRecord } from "../../app/models/stats-sync/stats-sync-record.ts";

/**
 * Connect the stats sync's writers to STATS_SYNC_DB, as Rails' abstract class
 * would `connects_to` it from database.yml at boot: the connection is the
 * application's configuration, read once here, not a side effect of loading
 * the model. `establishConnection` opens no file until something queries.
 */
await StatsSyncRecord.establishConnection(statsSyncDatabaseConfig());
