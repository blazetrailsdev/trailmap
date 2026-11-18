import { afterAll } from "vitest";
import { env, setEnv } from "@blazetrails/ruby-compat";
import { isolateTestEnv } from "./support/test-env.ts";

/**
 * Rails' `test/test_helper.rb`, as `trails new` generates it: set the
 * environment, boot `config/environment`, then `trails/test-help`, which
 * maintains the test schema and points the test cases at the application's
 * fixtures and routes. vitest loads it as a setup file, so every test file
 * runs against the booted application.
 */
if (env.TRAILS_ENV == null) setEnv("TRAILS_ENV", "test");
isolateTestEnv();
await import("../config/environment.ts");
await import("@blazetrails/trailties/test-help");

// Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical
// order: the generated helper's `fixtures :all`.
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
// It runs ONCE per worker. vitest re-evaluates this helper for every file
// the worker runs, so the later files still point the configurations at the
// worker's copy, but skip the truncate: every row a test writes is inside its fixture
// transaction, so the next file finds the database as the fixtures left it.
//
// The latch below is trailmap's, and temporary: Rails runs `parallelize_setup`
// once per forked worker, and test-help should do the same for every vitest
// app. Story: test-databases-once-per-vitest-worker, which deletes it.
const { TestDatabases } = await import("@blazetrails/activerecord/test-databases");
const worker = Number(env.VITEST_POOL_ID ?? 0);
const prepared = `TRAILMAP_TEST_DATABASE_${worker}_PREPARED`;
const truncate = env.SKIP_TEST_DATABASE_TRUNCATE;
if (env[prepared] != null) setEnv("SKIP_TEST_DATABASE_TRUNCATE", "1");
try {
  await TestDatabases.createAndLoadSchema(worker, { envName: "test" });
} finally {
  setEnv("SKIP_TEST_DATABASE_TRUNCATE", truncate);
}
setEnv(prepared, "1");

// `Hub` connected at boot to the URL the configuration names, which is the
// SHARED hub test database; the rows a worker writes and reads belong in its
// own copy, the one `createAndLoadSchema` just rebuilt.
const { hubTestUrl } = await import("./support/hub-schema.ts");
const hubUrl = hubTestUrl();
if (hubUrl !== null) {
  const { Hub } = await import("../app/models/hub.ts");
  const { hubDatabaseConfig } = await import("../config/database.ts");
  await Hub.establishConnection({ ...hubDatabaseConfig(), url: hubUrl });
}

// The columns, warmed as config/environment.ts warms them for a served
// process, which it skips here because `test` has no TASKS_DATABASE. After
// test-help, because that is what loads the schema into this file's database.
const { loadModelSchemas } = await import("../lib/model-schemas.ts");
await loadModelSchemas();

// Close this file's connections when it finishes: vitest runs the next file in
// the same worker, and a connection left open here would hold
// `storage/test.sqlite3-<n>` locked. `test/global-setup.ts`'s teardown, per file.
afterAll(async () => {
  const { Base } = await import("@blazetrails/activerecord");
  await Base.connectionHandler.clearAllConnectionsBang("all");
});
