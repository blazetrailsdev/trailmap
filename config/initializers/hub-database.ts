import { env } from "@blazetrails/ruby-compat";
import { hasHubDatabase, hubDatabaseConfig } from "../database.js";
import { Hub } from "../../app/models/hub.js";
import { loadHubSchemas } from "../../app/models/index.js";

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
}

await connectToHubDatabase();
