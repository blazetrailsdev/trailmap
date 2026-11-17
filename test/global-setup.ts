import { Base } from "@blazetrails/activerecord";
import { env, setEnv } from "@blazetrails/ruby-compat";

/**
 * Bring the test databases up to date ONCE per run, before vitest starts its
 * workers: Rails maintains the test schema in the parent process before
 * `parallelize` forks, and this is that step. It is `trails new`'s own
 * `test/global-setup.ts`.
 *
 * Without it every test file's `test/test-helper.ts` would find the schema
 * stale at the same moment and purge the same database from parallel workers.
 */
export async function setup(): Promise<void> {
  if (env.TRAILS_ENV == null) setEnv("TRAILS_ENV", "test");
  await import("../config/environment.ts");
  await import("@blazetrails/trailties/testing/maintain-test-schema");
}

export async function teardown(): Promise<void> {
  await Base.connectionHandler.clearAllConnectionsBang("all");
}
