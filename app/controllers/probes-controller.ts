import { env, getChildProcessAsync, getFs, getPath } from "@blazetrails/ruby-compat";
import { ApplicationController } from "./application-controller.js";
import { requireLoopback } from "./concerns/loopback-only.js";
import { Story } from "../models/index.js";
import { hasTasksDatabase, tasksDatabaseConfig } from "../../config/database.js";
import { tasksContentDir } from "../../config/tasks-content.js";

/** One check's verdict. `error` is present exactly when `ok` is false. */
export interface Check {
  ok: boolean;
  error?: string;
  [detail: string]: unknown;
}

/**
 * `/up/ready` and `/up/deep` — the two probes beside `/up`.
 *
 * `/up` (HealthController) answers "did the process boot", touches no
 * dependency, and feeds the restart policy. It cannot see a process-up
 * failure: a database that will not open, an empty backlog after a failed
 * ingest, a tasks checkout the container cannot write. These probes can, and
 * they live in their own controller so that nothing here can ever make `/up`
 * go red.
 *
 * - `ready` answers "can this serve correct answers right now". Red means stop
 *   routing here, not restart. Every check runs on every request, so the body
 *   names every check whether or not an earlier one failed.
 * - `deep` computes a real ready queue. It is expensive on purpose and is
 *   called by the canary, never by a supervisor.
 *
 * Both are loopback-only, like the rest of the JSON API.
 */
export class ProbesController extends ApplicationController {
  static {
    this.beforeAction(requireLoopback);
  }

  /**
   * The keys are snake_case because they are wire names, like every other
   * JSON body this API answers (`bundle_total_loc`, `exit_code`): the readers
   * are `jq` and ringo's Go structs, not TypeScript.
   */
  async ready(): Promise<void> {
    const database = await this.check(() => this.checkDatabase());
    const checks: Record<string, Check> = {
      database,
      stories: this.checkStories(database),
      migrations: await this.check(() => this.checkMigrations()),
      checkout: await this.check(() => this.checkCheckout()),
      git_identity: await this.check(() => this.checkGitIdentity()),
    };
    const failing = Object.keys(checks).filter((name) => !checks[name]!.ok);
    await this.render({
      json: { status: failing.length === 0 ? "ok" : "unready", failing, checks },
      status: failing.length === 0 ? 200 : 503,
    });
  }

  /**
   * The queue is the unscoped one `GET /stories/ready` answers and the spawn
   * loop consumes, across every repository: the canary asks whether THAT queue
   * can be computed, not one repository's slice of it.
   *
   * It does not hold the pool's one connection across the ranking — each of
   * its six queries leases and returns it — so a `ready` arriving meanwhile is
   * not refused by the checkout timeout. It IS delayed: SQLite here is
   * synchronous and the ranking is CPU on the one thread, so everything else
   * the process serves waits roughly `latency_ms`. Eight at once held `ready`
   * for eight seconds, still 200. One caller, one at a time.
   */
  async deep(): Promise<void> {
    const started = performance.now();
    try {
      const index = await Story.rankingIndex();
      const rows = await Story.claimable({ index });
      const latencyMs = Math.round(performance.now() - started);
      await this.render({ json: { status: "ok", ready: { rows: rows.length, latency_ms: latencyMs } } });
    } catch (e) {
      await this.render({ json: { status: "down", error: (e as Error).message }, status: 503 });
    }
  }

  /**
   * A check that RAISES is a red check, with its name in the body like any
   * other. Without this a throw anywhere in one is a bare 500 naming nothing.
   */
  private async check(run: () => Promise<Check>): Promise<Check> {
    try {
      return await run();
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /**
   * Two questions, because the count alone cannot answer the first: the pool
   * holds the file open, so a `tasks.db` that was moved aside or deleted after
   * boot keeps answering queries from the unlinked inode — green, and reading a
   * database the CLI and ringo no longer write. So the path `TASKS_DATABASE`
   * names has to still be there, and then a count, the cheapest query that
   * reads a real table, has to succeed.
   */
  private async checkDatabase(): Promise<Check> {
    if (hasTasksDatabase()) {
      const file = String(tasksDatabaseConfig().database);
      if (!(await getFs().exists(file))) {
        return { ok: false, error: `${file} is gone: the open connection is reading a file nothing else can see` };
      }
    }
    return { ok: true, stories: await Story.count() };
  }

  /**
   * A database that opens and holds no stories is a failed ingest, and the
   * spawn loop would tick on an empty queue. It reads the database check's
   * count rather than asking twice, so with the database red it reports that
   * it could not look — a different failure from "looked and found none".
   */
  private checkStories(database: Check): Check {
    if (!database.ok) return { ok: false, error: "not counted: the database check failed" };
    const count = Number(database.stories);
    return count > 0 ? { ok: true, count } : { ok: false, count, error: "the stories table is empty" };
  }

  /**
   * A deploy replaces the container. If a migration did not run, every page
   * still renders and every other check here stays green, while the ready
   * queue ranks over columns that are not what the code expects.
   *
   * The head the code expects is READ FROM `db/migrate`, on every request, by
   * the pool's own `MigrationContext` — the object `trails db migrate` asks
   * for the same list. It is not baked in at build time, for three reasons:
   *
   * - it cannot drift. A generated constant is a second copy of the directory
   *   and something has to regenerate it; this is the directory.
   * - it is where Rails reads it. `MigrationContext#migrations` lists the
   *   files (activerecord/lib/active_record/migration.rb:1303-1317), and
   *   `CheckPending` (:648) reaches it per request through
   *   `pool.migration_context.open.pending_migrations` (:758-770).
   * - the image ships `db/migrate` already, because the release task runs it.
   *
   * The cost is one directory listing per probe, of a directory with a handful
   * of entries.
   *
   * The two heads are compared for EQUALITY, which is deliberately MORE than
   * Rails asks of the same list. `needs_migration?` is `pending_migration_versions.size > 0`,
   * and that is `migrations.collect(&:version) - get_all_versions`
   * (migration.rb:1295-1301): files with no row, so a database that is ahead
   * passes it. This database is also migrated by the tasks CLI
   * (config/database.ts), so it can be AHEAD of a trailmap that has not been
   * redeployed, and that is the same wrong-columns failure from the other side.
   *
   * It asks `Story`'s pool, so it is the database the queue is read from. The
   * hub has its own history (`db/hub-migrate`) and its own guard at boot.
   */
  private async checkMigrations(): Promise<Check> {
    const context = Story.connectionPool().migrationContext;
    const expected = context.migrations.at(-1)?.version ?? null;
    const actual = (await context.currentVersion()) || null;
    const versions = { expected, actual };
    if (expected === null) {
      return { ok: false, ...versions, error: `no migrations found under ${context.migrationsPaths}` };
    }
    if (actual === expected) return { ok: true, ...versions };
    return {
      ok: false,
      ...versions,
      error:
        `schema_migrations is at ${actual ?? "no version"}, and db/migrate expects ${expected}: ` +
        (actual !== null && actual > expected
          ? "the database is ahead of this release"
          : "a migration did not run"),
    };
  }

  /**
   * Writable is proven by writing. The probe is an empty directory, made and
   * removed: git does not track one, so an authoring commit racing this
   * request (`git add -A`) cannot pick it up, which a probe FILE could.
   *
   * A directory that was made and could not be removed is a red check naming
   * the leftover, so it is cleaned up by a person rather than accumulating
   * unseen — `git status` does not show an empty directory.
   */
  private async checkCheckout(): Promise<Check> {
    const dir = tasksContentDir();
    if (dir === null) return { ok: false, error: "TASKS_DIR names no tasks checkout" };
    const fs = getFs();
    if (!fs.mkdtemp || !fs.rmdir) {
      return { ok: false, dir, error: "the filesystem adapter cannot make a directory asynchronously" };
    }
    let probe: string;
    try {
      probe = await fs.mkdtemp(getPath().join(dir, ".up-ready-"));
    } catch (e) {
      return { ok: false, dir, error: (e as Error).message };
    }
    try {
      await fs.rmdir(probe);
    } catch (e) {
      return { ok: false, dir, error: `left ${probe} behind: ${(e as Error).message}` };
    }
    return { ok: true, dir };
  }

  /**
   * Authoring and ingest commit into the checkout, and git refuses with
   * "Author identity unknown" when it cannot name one (see the Dockerfile).
   * `git var` resolves each identity exactly as a commit there would — config,
   * then `GIT_AUTHOR_*` / `GIT_COMMITTER_*` / `EMAIL` — and fails as the
   * commit would. Reading `user.name` out of the config instead would go red
   * on a host that sets its identity through the environment.
   *
   * The directory reaches the shell as a variable, never spliced into the
   * command line, so there is no quoting to get wrong.
   */
  private async checkGitIdentity(): Promise<Check> {
    const dir = tasksContentDir();
    if (dir === null) return { ok: false, error: "TASKS_DIR names no tasks checkout" };
    const child = await getChildProcessAsync();
    if (!child.capture2e) return { ok: false, error: "the child-process adapter cannot capture output" };
    for (const ident of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) {
      const [output, status] = await child.capture2e(`git -C "$UP_READY_DIR" var ${ident}`, {
        ...env,
        UP_READY_DIR: dir,
      });
      if (status.error) return { ok: false, error: status.error.message };
      if (status.status !== 0) return { ok: false, error: `${ident}: ${output.trim()}` };
    }
    return { ok: true };
  }
}
