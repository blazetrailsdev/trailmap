import { env, setEnv } from "@blazetrails/ruby-compat";

/**
 * The variables a developer exports to SERVE trailmap (README "Running it")
 * that the suite must never read: each names a live resource — the CLI's
 * `tasks.db`, the tasks checkout, ringo, the stats files — and a test that
 * inherits one renders the developer's data instead of its fixtures.
 */
const LIVE_VARIABLES = [
  "TASKS_DATABASE",
  "TASKS_DIR",
  "AUDITS_DIR",
  "DEPLOY_LOGS_DIR",
  "FLEET_REPO_PATHS",
  "RINGO_BASE",
  "STATS_DB",
  "STATS_SYNC_DB",
  "STATS_SYNC_LOG",
  "TRAILMAP_INGEST_TOKEN",
] as const;

/**
 * Give the suite only its own values, whatever the shell exported.
 *
 * `HUB_DATABASE_URL` becomes `HUB_TEST_DATABASE_URL` (unset when that is): the
 * test environment's `hub` reads the boot variable, and the dev hub is not a
 * database the suite may truncate. Called before the application boots, in
 * the parent (test/global-setup.ts) and in every worker (test/test-helper.ts).
 */
export function isolateTestEnv(): void {
  for (const name of LIVE_VARIABLES) setEnv(name, undefined);
  setEnv("HUB_DATABASE_URL", env.HUB_TEST_DATABASE_URL?.trim() || undefined);
}
