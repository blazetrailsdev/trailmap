import { env } from "@blazetrails/ruby-compat";
import { Hub } from "../../app/models/hub.js";
import { loadHubSchemas } from "../../app/models/index.js";
import { Setting } from "../../app/models/setting.js";

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
 * Hold the same lock for one block, on whatever connection `Hub` currently
 * has.
 *
 * For a test that touches the shared hub database WITHOUT going through
 * `connectHubTestDatabase` — `hub-database.test.ts` connects the way the
 * application does, through `HUB_DATABASE_URL`, so it is not serialized by
 * the `beforeAll`/`afterAll` pair below and would otherwise run on top of
 * whichever file is holding the lock.
 */
export async function withHubTestLock<T>(fn: () => Promise<T>): Promise<T> {
  await Hub.connectionPool().withConnection(async (connection) => {
    await connection.execute("SET lock_timeout = '60s'");
    await connection.execute(`SELECT pg_advisory_lock(${HUB_TEST_LOCK})`);
  });
  try {
    return await fn();
  } finally {
    await Hub.connectionPool().withConnection((connection) =>
      connection.execute(`SELECT pg_advisory_unlock(${HUB_TEST_LOCK})`),
    );
  }
}

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
  await Hub.establishConnection({ adapter: "postgresql", url, pool: 1 });

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
    await connection.execute("SET lock_timeout = '60s'");
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
