import { afterAll } from "vitest";
import { env, setEnv } from "@blazetrails/ruby-compat";

/**
 * Rails' `test/test_helper.rb`, as `trails new` generates it: set the
 * environment, boot `config/environment`, then `trails/test-help`, which
 * maintains the test schema and points the test cases at the application's
 * fixtures and routes. vitest loads it as a setup file, so every test file
 * runs against the booted application.
 */
if (env.TRAILS_ENV == null) setEnv("TRAILS_ENV", "test");
await import("../config/environment.ts");
await import("@blazetrails/trailties/test-help");

// Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical
// order: the generated helper's `fixtures :all`. The shared seed rows move
// there in `seed-trailmap-tests-from-fixtures`.
const { TestCase } = await import("@blazetrails/activesupport/test-case");
TestCase.fixtures(":all");

// Rails' `parallelize_setup`: each worker gets its own copy of every test
// database, `storage/test.sqlite3-<n>`, rebuilt from db/schema.ts.
//
// No `parallelize(workers: :number_of_processors)` line: vitest's pool IS the
// parallelizer here, forking its workers before this file runs, and
// VITEST_POOL_ID is the worker number Rails' `parallelize` would hand
// `parallelize_setup`.
//
// It runs per FILE rather than once per worker because the files still seed
// rows in `beforeAll` outside any transaction, so each must start from an
// empty database. `seed-trailmap-tests-from-fixtures` moves those rows into
// test/fixtures and this back to once per worker.
const { TestDatabases } = await import("@blazetrails/activerecord/test-databases");
await TestDatabases.createAndLoadSchema(Number(env.VITEST_POOL_ID ?? 0), { envName: "test" });

// The columns, warmed as config/environment.ts warms them for a served
// process, which it skips here because `test` has no TASKS_DATABASE. After
// test-help, because that is what loads the schema into this file's database.
const { loadModelSchemas } = await import("../lib/model-schemas.ts");
await loadModelSchemas();

// Close this file's connections when it finishes. vitest runs the next file in
// the same worker, and that file rebuilds `storage/test.sqlite3-<n>` above:
// a connection left open here would hold it and fail the rebuild on
// "database is locked". `test/global-setup.ts`'s teardown, per file.
afterAll(async () => {
  const { Base } = await import("@blazetrails/activerecord");
  await Base.connectionHandler.clearAllConnectionsBang("all");
});
