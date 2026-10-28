import { ApplicationController } from "./application-controller.ts";
import { ringoFailure } from "../../lib/ringo-failure.ts";
import { Setting } from "../models/setting.ts";
import { deployLogsDir, readDeployLog, readsDeployLogLocally } from "../models/deploy-log.ts";

/**
 * How long ringo has to answer for the deploy history or one run's log. A
 * page load waits on it, so it is short; ringo answers both from memory and
 * one file read.
 */
export const DEPLOYS_TIMEOUT_MS = 5_000;

/** One row of ringo's `/api/deploys` (`webhook/deploys_page.go`, `HandleDeploysAPI`). */
export interface DeployRow {
  id: string;
  app: string;
  repo: string;
  branch: string;
  sha: string;
  message: string;
  status: string;
  exitCode: number;
  started: string;
  seconds: number;
  /** The pane log's path as the tmux server wrote it; only its base name is read. */
  logFile?: string;
  error?: string;
}

/**
 * `/deploys` and `/deploys/log?id=<run>`, read-only, beside ringo's own.
 *
 * Neither reads a model. The deploy history is ringo's `DeployStore`: a JSON
 * file on ringo's disk, relayed over the private network as the fleet page's
 * reads are, and rendered here in the order ringo keeps it: newest first.
 *
 * Each run's log is the `pipe-pane` capture of the tmux pane the deploy ran
 * in. Those are read from ringo's pane-log directory, mounted read-only
 * (`DEPLOY_LOGS_DIR`, `readDeployLog`). WHICH file is the run's own: `log`
 * looks the id up in the history and opens the `logFile` that row names,
 * never a name the request supplies, so the route reads deploy logs and no
 * other pane's. A run whose row names no file, or no mount, relays ringo.
 */
export class DeploysController extends ApplicationController {
  async index(): Promise<void> {
    this.noStore();
    const base = await Setting.ringoBase();
    const { runs, problem } =
      base === null ? { runs: [], problem: "no ringo origin is configured" } : await deployHistory(base);
    // While a deploy runs the page re-reads itself (app/assets/javascripts/deploys.js),
    // as ringo's polls `/api/deploys`; a finished history is left still.
    const refreshing = runs.some((run) => run.status === "running");
    await this.render({ locals: { runs, problem, refreshing } });
  }

  /** One run's log, as ringo serves it: the capture verbatim, as plain text. */
  async log(): Promise<void> {
    this.noStore();
    const id = String(this.params.get("id") ?? "");
    if (id === "") {
      await this.render({ plain: "unknown deploy", status: 404 });
      return;
    }
    const base = await Setting.ringoBase();
    if (base === null) {
      await this.render({ plain: "no ringo origin is configured", status: 503 });
      return;
    }
    if (deployLogsDir() !== "") {
      const run = (await deployHistory(base)).runs.find((r) => r.id === id);
      if (run?.logFile && readsDeployLogLocally(run.logFile)) {
        // ringo answers a missing capture 200 with the reason as the text.
        await this.render({ plain: await readDeployLog(run.logFile) });
        return;
      }
    }
    try {
      const response = await fetch(`${base}/deploys/log?id=${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(DEPLOYS_TIMEOUT_MS),
      });
      await this.render({ plain: await response.text(), status: response.status });
    } catch (error) {
      await this.render(ringoFailure(error, DEPLOYS_TIMEOUT_MS));
    }
  }
}

/** ringo's deploy history, newest first, or why there is none to show. */
async function deployHistory(base: string): Promise<{ runs: DeployRow[]; problem: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${base}/api/deploys`, { signal: AbortSignal.timeout(DEPLOYS_TIMEOUT_MS) });
  } catch (error) {
    return { runs: [], problem: ringoFailure(error, DEPLOYS_TIMEOUT_MS).plain };
  }
  // The status alone: an error body may be a proxy's whole HTML page.
  if (!response.ok) return { runs: [], problem: `ringo answered ${response.status}` };
  try {
    return { runs: (await response.json()) as DeployRow[], problem: null };
  } catch {
    return { runs: [], problem: "ringo answered, but not with the deploy history as JSON" };
  }
}
