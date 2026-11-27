import { Base } from "@blazetrails/activerecord";
import { env, setEnv } from "@blazetrails/ruby-compat";
import { isolateTestEnv } from "./support/test-env.ts";
import { buildStaleViews } from "./support/build-views.ts";
import { ViteAssets } from "@blazetrails/vite-assets";

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
  isolateTestEnv();
  await import("../config/environment.ts");
  await buildStaleViews();
  // Build the test assets once, before the workers. Otherwise every worker
  // finds the last build stale at the same moment and runs its own autoBuild,
  // and Vite's emptied outDir hands the others `manifest: {}`
  // (MissingEntrypointError on a varying set of controller tests). vite_ruby
  // has the same race; Rails apps build in CI before the suite.
  if (!(await ViteAssets.instance().builder().build())) throw new Error("vite build for the test suite failed");
  await import("@blazetrails/trailties/testing/maintain-test-schema");
}

export async function teardown(): Promise<void> {
  await Base.connectionHandler.clearAllConnectionsBang("all");
}
