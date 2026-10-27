import { Trails } from "@blazetrails/trailties";
import { hasStatsDatabase, statsDatabaseConfig } from "../database.ts";
import { Stats } from "../../app/models/stats.ts";
import { loadStatsSchemas } from "../../app/models/index.ts";

/**
 * Connect the trails comparison stats to the stats database, read-only.
 *
 * The THIRD connection in this process, on the third adapter — `node-sqlite`,
 * where the task domain is better-sqlite3 and the hub is PostgreSQL. See
 * app/models/stats.ts, and config/database.ts for why a second SQLite driver.
 *
 * An unset `STATS_DB` is NOT a boot failure, which is the one place this file
 * deliberately differs from its two neighbours.
 *
 * `tasks-database.ts` and `hub-database.ts` both throw, and they are right to:
 * without those connections EVERY page 500s, so a process that comes up
 * answers dokku's `GET /up` green (the healthcheck touches no row) and then
 * fails on everything. The stats database backs exactly one page. It is also a
 * multi-gigabyte host file that only the box running the nightly sync cron
 * has, so demanding it would make trailmap undeployable anywhere else to gain
 * nothing. The correct behaviour for a missing OPTIONAL source is the page
 * saying so, which is what `ParityGraphsController` does.
 *
 * Schemas warm here for the reason they do in the other two: `columnNames()`
 * is reflection, reflection is lazy, and the metric picker asks which columns
 * exist before it runs a query. See `loadStatsSchemas`.
 *
 * Two halves, split the way a Rails app splits them. Importing this file only
 * registers the connection, and `establishConnection` opens no socket, so
 * anything that loads initializers without serving — `pnpm views` builds
 * templates this way (trails#9284) — needs no database. The I/O runs in a
 * `server` block (trails#9375), which `trails server` awaits before it binds,
 * so a misconfigured process still never serves. The named export is that
 * block, and the test calls it directly.
 */
export async function connectToStatsDatabase(): Promise<void> {
  if (!hasStatsDatabase()) return;
  await Stats.establishConnection(statsDatabaseConfig());
  await loadStatsSchemas();
}

if (hasStatsDatabase()) await Stats.establishConnection(statsDatabaseConfig());
Trails.application.server(connectToStatsDatabase);
