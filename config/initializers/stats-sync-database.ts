import { constantize } from "@blazetrails/activesupport";
import { Trails } from "@blazetrails/trailties";
import { statsSyncDatabaseConfig } from "../database.ts";
import type { StatsSyncRecord } from "../../app/models/stats-sync/stats-sync-record.ts";

/**
 * Connect the stats sync's writers to STATS_SYNC_DB, as Rails' abstract class
 * would `connects_to` it from database.yml at boot: the connection is the
 * application's configuration, not a side effect of loading the model.
 *
 * In `toPrepare`, not at the top of this file, because `StatsSyncRecord` is
 * autoloaded and an initializer must not reference a reloadable constant
 * (railties/lib/rails/application/finisher.rb). A static import here is a
 * second instance of the class under vitest, and its subclasses would not
 * inherit this connection. `establishConnection` opens no file until
 * something queries.
 */
Trails.application.config.toPrepare(async () => {
  const record = constantize("StatsSync::StatsSyncRecord") as typeof StatsSyncRecord;
  await record.establishConnection(statsSyncDatabaseConfig());
});
