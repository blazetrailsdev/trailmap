import { env } from "@blazetrails/ruby-compat";
import { Hub } from "../../app/models/hub.ts";
import { HUB_MIGRATIONS_PATH } from "../../config/database.ts";
import { loadHubSchemas } from "../../app/models/index.ts";
import { Setting } from "../../app/models/setting.ts";

/**
 * Connect `Hub` to a throwaway Postgres database and empty it —
 * `test/models/schema.ts`'s twin, for the other database.
 *
 * Three differences from that one, and all three are the adapter's:
 *
 * - **There is no `:memory:`.** Postgres is a server, so this needs a real
 *   database, and the tests clean up after themselves (`truncateHub`).
 * - **It is OPT-IN, through `HUB_TEST_DATABASE_URL`.** Most of the suite never
 *   touches the hub; CI runs a `postgres:` service container for the jobs that
 *   do, and a machine without one skips those tests — visibly, never silently.
 * - **It does NOT migrate.** The SQLite twin runs `MigrationContext` in the
 *   worker, which works there because the migrator's advisory-lock check leases
 *   `ActiveRecord::Base`'s own connection — and `Base` IS the database under
 *   test there. Here it is the task database, so migrating in-process would
 *   either fail or run the hub's migrations down the wrong connection. The
 *   database is prepared OUTSIDE the suite, by the real entry point:
 *
 *       HUB_DATABASE_URL=<the test database> pnpm db:migrate
 *
 *   which is what `.github/workflows/ci.yml` does before `pnpm test`, and what
 *   the error below tells you to run. `trails db migrate` is therefore still
 *   what exercises the migrations; it just happens one step earlier.
 *
 * Deliberately NOT `HUB_DATABASE_URL`: that variable names the database a
 * development or production process is serving from, and this module's job is
 * to truncate every table it finds. A separate variable is the only thing
 * between a test run and someone's rows.
 */
export function hubTestUrl(): string | null {
  const url = env.HUB_TEST_DATABASE_URL?.trim();
  return url ? url : null;
}

/** Whether the hub tests can run here. They skip, loudly, when they cannot. */
export function hasHubTestDatabase(): boolean {
  return hubTestUrl() !== null;
}

/** The hub tables, in one list: what is truncated, and what must exist. */
const HUB_TABLES = [
  "owners",
  "repositories",
  "repository_settings",
  "repository_collaborators",
  "settings",
  // A projection rather than state, but it is truncated like the rest: a run
  // left behind by another file's refresh would make this file's row counts
  // wrong, and the hub test database is shared.
  "parity_days",
] as const;

/**
 * One advisory lock, held for as long as a test FILE is using the hub.
 *
 * vitest runs files in parallel workers, and there is one hub test database:
 * without this, one file's `truncateHub` lands in the middle of another file's
 * fixtures and the two fail each other intermittently (`two-adapters` lost its
 * rows to `repo-tabs` exactly that way). Postgres has no `:memory:` to give
 * each worker its own copy, so the files take turns instead.
 *
 * `lock_timeout` is what keeps a mistake loud: a file that forgets
 * `releaseHubTestDatabase` would otherwise hang the suite with no message,
 * instead of failing here and naming the lock.
 */
const HUB_TEST_LOCK = 0x7471_6d70;

/**
 * How long a file may wait for that lock, in seconds: long enough to queue
 * behind EVERY other hub file on a loaded machine, not vitest's default 10s
 * hook timeout. Behind six other files at load average 50, the wait alone
 * passed 10s, and "Hook timed out in 10000ms" landed on a different file each
 * run. The files take turns by design, so the wait is the cost of the turn.
 */
const HUB_LOCK_WAIT_SECONDS = 180;

/**
 * The timeout for the `beforeAll` that calls `connectHubTestDatabase`:
 * `beforeAll(fn, HUB_SETUP_TIMEOUT)`. A little longer than the lock wait, so a
 * file that never gets the lock fails on `lock_timeout`, which names the lock,
 * rather than on a hook timeout that names nothing.
 */
export const HUB_SETUP_TIMEOUT = (HUB_LOCK_WAIT_SECONDS + 30) * 1000;

export async function connectHubTestDatabase(): Promise<void> {
  const url = hubTestUrl();
  if (url === null) {
    throw new Error(
      "HUB_TEST_DATABASE_URL is not set. Ask `hasHubTestDatabase()` first, or point " +
        "it at a THROWAWAY Postgres database — this truncates every table in it.",
    );
  }
  // `pool: 1` is load-bearing, not tidiness: the advisory lock below is
  // SESSION-scoped, so taking it on one pooled connection and releasing it on
  // another would leak it and hang the next test file.
  // `migrationsPaths` as `hubDatabaseConfig()` passes it, so the pool's
  // `MigrationContext` lists `db/hub-migrate` here as it does when serving.
  await Hub.establishConnection({ adapter: "postgresql", url, pool: 1, migrationsPaths: HUB_MIGRATIONS_PATH });

  const present = new Set(await Hub.connectionPool().withConnection((c) => c.tables()));
  const missing = HUB_TABLES.filter((table) => !present.has(table));
  if (missing.length > 0) {
    throw new Error(
      `HUB_TEST_DATABASE_URL names a database without the hub schema (no ${missing.join(", ")}). ` +
        "Prepare it with: HUB_DATABASE_URL=$HUB_TEST_DATABASE_URL pnpm db:migrate " +
        "(no --database flag — see docs/deploy.md).",
    );
  }

  await Hub.connectionPool().withConnection(async (connection) => {
    await connection.execute(`SET lock_timeout = '${HUB_LOCK_WAIT_SECONDS}s'`);
    await connection.execute(`SELECT pg_advisory_lock(${HUB_TEST_LOCK})`);
  });

  await loadHubSchemas();
  await truncateHub();
}

/**
 * Hand the hub back to the next test file. Every file that calls
 * `connectHubTestDatabase` in `beforeAll` calls this in `afterAll`.
 */
export async function releaseHubTestDatabase(): Promise<void> {
  if (hubTestUrl() === null) return;
  await Hub.connectionPool().withConnection(async (connection) => {
    await connection.execute(`SELECT pg_advisory_unlock(${HUB_TEST_LOCK})`);
  });
}

/**
 * Empty every hub table.
 *
 * Worth calling between cases that write, not just once per file: vitest
 * isolates files in workers rather than cases, and `owners.login` is unique,
 * so a row left by the previous case fails the next one's `create` rather than
 * being ignored.
 *
 * Also drops `Setting`'s memo of the `settings` rows. That cache exists so the
 * polled fleet paths do not query Postgres per request, and it is keyed by
 * time, not by the rows — so a `settings` row truncated out from under it
 * would otherwise keep winning over the environment for another ten seconds
 * and fail the next case for reasons nothing on screen explains.
 */
export async function truncateHub(): Promise<void> {
  await Hub.connectionPool().withConnection(async (connection) => {
    await connection.execute(
      `TRUNCATE ${HUB_TABLES.join(", ")} RESTART IDENTITY CASCADE`,
    );
  });
  Setting.forgetResolved();
}
