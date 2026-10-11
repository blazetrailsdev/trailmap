import { env, getChildProcessAsync, getFs, getPath } from "@blazetrails/ruby-compat";
import { ApplicationController } from "./application-controller.js";
import { requireLoopback } from "./concerns/loopback-only.js";
import { Story } from "../models/index.js";
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

  async ready(): Promise<void> {
    const database = await this.checkDatabase();
    const checks: Record<string, Check> = {
      database,
      stories: this.checkStories(database),
      checkout: await this.checkCheckout(),
      git_identity: await this.checkGitIdentity(),
    };
    const failing = Object.keys(checks).filter((name) => !checks[name]!.ok);
    await this.render({
      json: { status: failing.length === 0 ? "ok" : "unready", failing, checks },
      status: failing.length === 0 ? 200 : 503,
    });
  }

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

  /** Opens the database: a count is the cheapest query that reads a real table. */
  private async checkDatabase(): Promise<Check> {
    try {
      return { ok: true, stories: await Story.count() };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
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
   * Writable is proven by writing. The probe is an empty directory, made and
   * removed: git does not track one, so an authoring commit racing this
   * request (`git add -A`) cannot pick it up, which a probe FILE could.
   */
  private async checkCheckout(): Promise<Check> {
    const dir = tasksContentDir();
    if (dir === null) return { ok: false, error: "TASKS_DIR names no tasks checkout" };
    const fs = getFs();
    if (!fs.mkdtemp || !fs.rmdir) {
      return { ok: false, dir, error: "the filesystem adapter cannot make a directory asynchronously" };
    }
    try {
      await fs.rmdir(await fs.mkdtemp(getPath().join(dir, ".up-ready-")));
      return { ok: true, dir };
    } catch (e) {
      return { ok: false, dir, error: (e as Error).message };
    }
  }

  /**
   * Authoring and ingest commit into the checkout, and git refuses with
   * "Author identity unknown" when either half is unset (see the Dockerfile).
   * `git config --get` reads what a commit there would read, and exits
   * non-zero for an unset key.
   */
  private async checkGitIdentity(): Promise<Check> {
    const dir = tasksContentDir();
    if (dir === null) return { ok: false, error: "TASKS_DIR names no tasks checkout" };
    const child = await getChildProcessAsync();
    if (!child.capture2e) return { ok: false, error: "the child-process adapter cannot capture output" };
    const quoted = `'${dir.replace(/'/g, `'\\''`)}'`;
    const missing: string[] = [];
    for (const key of ["user.name", "user.email"]) {
      const [output, status] = await child.capture2e(`git -C ${quoted} config --get ${key}`, { ...env });
      if (status.error) return { ok: false, error: status.error.message };
      if (status.status !== 0 || output.trim() === "") missing.push(key);
    }
    if (missing.length > 0) return { ok: false, error: `git has no ${missing.join(" or ")} in ${dir}` };
    return { ok: true };
  }
}
