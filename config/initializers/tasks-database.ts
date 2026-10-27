import { Trails } from "@blazetrails/trailties";
import { Base } from "@blazetrails/activerecord";
import { env } from "@blazetrails/ruby-compat";
import { hasTasksDatabase, tasksDatabaseConfig } from "../database.ts";
import { loadModelSchemas } from "../../app/models/index.ts";

/**
 * Point the models at the CLI's live `tasks.db` when `TASKS_DATABASE` names
 * one.
 *
 * trailmap IS the writer now (see config/database.ts and the mutation
 * endpoints). This connection replaces the environment database the trailtie
 * established, because `storage/<env>.sqlite3` holds an empty schema and
 * answering the read verbs from it would serve an empty backlog instead of
 * failing loudly. Initializers load in sorted order, so this file's name is
 * what puts it after the rest.
 *
 * Schemas load here too, so the first request is not the one that discovers an
 * enum resolving against unreflected columns (see `loadModelSchemas`).
 *
 * Two halves, split the way a Rails app splits them. Importing this file only
 * registers the connection, and `establishConnection` opens no socket, so
 * anything that loads initializers without serving — `pnpm views` builds
 * templates this way (trails#9284) — needs no database. The I/O runs in a
 * `server` block (trails#9375), which `trails server` awaits before it binds,
 * so a misconfigured process still never serves. The named export is that
 * block, and the test calls it directly.
 *
 * An unset `TASKS_DATABASE` is a BOOT FAILURE, not a no-op. This is what
 * served the deployed 500s: nothing else in the boot path establishes a
 * connection — the ActiveRecord trailtie establishes one only for the `trails
 * db` commands — so a process that skipped this file had no pool for
 * `ActiveRecord::Base` at all, answered dokku's `GET /up` healthcheck (which
 * touches no model) green, and then raised `ConnectionNotDefined` on the first
 * page that reads a row. Failing here instead turns a misconfigured deployment
 * into a container that will not come up, which is the loud half of the same
 * fact.
 *
 * `test` is the one environment that legitimately has no live database: the
 * suite migrates its own scratch one (`test/models/schema.ts`), and importing
 * this file must not demand a second.
 */
export async function connectToTasksDatabase(): Promise<void> {
  if (!hasTasksDatabase()) {
    if ((env.NODE_ENV ?? "development") === "test") return;
    throw new Error(
      "TASKS_DATABASE is not set, so no connection would be established and every " +
        "page that reads a row would fail with ConnectionNotDefined. Point it at " +
        "the CLI's tasks.db (<tasks checkout>/.git/tasks.db); see docs/deploy.md.",
    );
  }
  await Base.establishConnection(tasksDatabaseConfig());
  await loadModelSchemas();
}

if (hasTasksDatabase()) await Base.establishConnection(tasksDatabaseConfig());
Trails.application.server(connectToTasksDatabase);
