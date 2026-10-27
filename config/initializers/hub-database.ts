import { Trails } from "@blazetrails/trailties";
import { env } from "@blazetrails/ruby-compat";
import { hasHubDatabase, hubDatabaseConfig } from "../database.ts";
import { Hub } from "../../app/models/hub.ts";
import { loadHubSchemas, missingHubTables } from "../../app/models/index.ts";

/**
 * Connect the owner/repository hierarchy to the `hub` Postgres database.
 *
 * Two connections, one process: this one is established on `Hub`
 * (app/models/hub.ts), and `tasks-database.ts` establishes the task domain's on
 * `ActiveRecord::Base` itself. Neither disturbs the other — a pool is keyed by
 * the connection specification name, and `Hub` has its own.
 *
 * Schemas load here for the reason they do there: `enum` resolves its storage
 * type from the reflected column, reflection is lazy, and reaching a model for
 * the first time THROUGH AN ASSOCIATION never loads it. See `loadHubSchemas`.
 *
 * Two halves, split the way a Rails app splits them. Importing this file only
 * registers the connection, and `establishConnection` opens no socket, so
 * anything that loads initializers without serving — `pnpm views` builds
 * templates this way (trails#9284) — needs no database. The I/O runs in a
 * `server` block (trails#9375), which `trails server` awaits before it binds,
 * so a misconfigured process still never serves. The named export is that
 * block, and the test calls it directly.
 *
 * An unset `HUB_DATABASE_URL` is a BOOT FAILURE outside `test`, as an unset
 * `TASKS_DATABASE` is: a process that comes up without it answers dokku's
 * `GET /up` green (the healthcheck touches no row) and then 500s with
 * `ConnectionNotDefined` on `/blazetrailsdev` and every page under it. That is
 * precisely what the deployed app did for eleven merged PRs. Failing here turns
 * a misconfigured deployment into a container that will not come up.
 *
 * `test` is the one environment that legitimately has none: most of the suite
 * never touches the hub, and the tests that do skip loudly when the variable is
 * unset (test/support/hub-schema.ts).
 *
 * An UNMIGRATED hub fails here too, for the same reason and with the same
 * remedy. A URL that points at a database with no tables is not a connection
 * problem — it connects, `loadHubSchemas` reflects happily, `GET /up` reads no
 * row and answers green — and the application then 500s with `relation
 * "repositories" does not exist` on `/dashboard` and every page under
 * `/:owner`. That is what trailmap#48 shipped and what the Procfile's
 * `release` task stops happening on a deploy; this stops it happening at all,
 * including when a database is replaced underneath a container that is
 * already running.
 */
export async function connectToHubDatabase(): Promise<void> {
  if (!hasHubDatabase()) {
    if ((env.NODE_ENV ?? "development") === "test") return;
    throw new Error(
      "HUB_DATABASE_URL is not set, so the owner/repository pages would fail with " +
        "ConnectionNotDefined on the first row they read. Point it at the hub " +
        "Postgres database (`dokku postgres:info trailmap-hub --dsn`); see docs/deploy.md.",
    );
  }
  await Hub.establishConnection(hubDatabaseConfig());
  await loadHubSchemas();

  const missing = await missingHubTables();
  if (missing.length > 0) {
    throw new Error(
      `HUB_DATABASE_URL names a database without the hub schema (no ${missing.join(", ")}). ` +
        "Migrate it — in the app container, because pnpm is not in the runtime image:\n" +
        "  dokku run trailmap bin/trails db migrate\n" +
        "See docs/deploy.md. Deploys do this themselves (Procfile release task).",
    );
  }
}

if (hasHubDatabase()) await Hub.establishConnection(hubDatabaseConfig());
Trails.application.server(connectToHubDatabase);
