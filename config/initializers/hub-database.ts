import { env } from "@blazetrails/ruby-compat";
import { hasHubDatabase, hubDatabaseConfig } from "../database.js";
import { Hub } from "../../app/models/hub.js";
import { loadHubSchemas, missingHubTables } from "../../app/models/index.js";

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
 * The work happens at import time because that is the whole contract for a
 * `config/initializers` file — `loadConfigInitializer` imports the module and
 * calls nothing. The named export exists for the test.
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
 * `/:owner`. That is what trailmap#48 shipped and what #50's predeploy stops
 * happening on a release; this stops it happening at all, including when a
 * database is replaced underneath a container that is already running.
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
        "  dokku run trailmap node_modules/.bin/tsx " +
        "node_modules/@blazetrails/trailties/bin/trails.js db migrate\n" +
        "See docs/deploy.md. Deploys do this themselves (app.json predeploy).",
    );
  }
}

await connectToHubDatabase();
