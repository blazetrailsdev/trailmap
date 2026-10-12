/**
 * Rebuild the `parity_days` projection from the stats database.
 *
 * `/graphs/parity` refreshes itself when it notices the projection has fallen
 * behind, so this is not on any critical path. It exists for the two cases the
 * page cannot cover: filling the table for the first time without waiting for
 * someone to load the page, and pushing a rebuild into a hub from a host that
 * has the stats database when the application's own host does not.
 *
 *     STATS_DB=... HUB_DATABASE_URL=... pnpm parity:sync [--force]
 *
 * `--force` refreshes a projection that is already up to date, which is what
 * you want after changing how a row is measured.
 */
import { argv, exit } from "@blazetrails/ruby-compat";
import { Hub } from "../app/models/hub.js";
import { Stats } from "../app/models/stats.js";
import { loadHubSchemas, loadStatsSchemas, ParityDay } from "../app/models/index.js";
import { hasHubDatabase, hasStatsDatabase, hubDatabaseConfig, statsDatabaseConfig } from "../config/database.js";
import { projectionIsStale, refreshProjectionIfStale } from "../app/models/parity-refresh.js";

const force = argv.includes("--force");

if (!hasStatsDatabase()) {
  console.error("STATS_DB is not set — there is nothing to project from.");
  exit(1);
}
if (!hasHubDatabase()) {
  console.error("HUB_DATABASE_URL is not set — there is nowhere to project to.");
  exit(1);
}

await Hub.establishConnection(hubDatabaseConfig());
await loadHubSchemas();
await Stats.establishConnection(statsDatabaseConfig());
await loadStatsSchemas();

const before = await ParityDay.count();
const stale = await projectionIsStale();

if (force) {
  console.log(`refreshing ${stale ? "a stale" : "an up-to-date"} projection (--force)`);
  const { metrics, rows } = await ParityDay.refreshFromStats();
  console.log(`projected ${rows} rows across ${metrics} runs`);
} else {
  const result = await refreshProjectionIfStale();
  if (result.ran) console.log(`projected ${result.rows} rows`);
  else if (result.why === "fresh") console.log("projection is up to date; --force to rebuild it");
  else if (result.why === "locked") console.log("another refresh holds the lock; nothing to do");
  else console.log(`nothing to do: ${result.why}`);
}

const after = await ParityDay.count();
console.log(`parity_days: ${before} -> ${after} rows`);

await Hub.connectionHandler.clearAllConnectionsBang();
