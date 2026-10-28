import { ApplicationController } from "./application-controller.ts";
import { ringoFailure } from "../../lib/ringo-failure.ts";
import { Setting } from "../models/setting.ts";
import { readDeployLog, readsDeployLogLocally } from "../models/deploy-log.ts";

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
 * (`DEPLOY_LOGS_DIR`, `readDeployLog`), so a log reads with ringo down; the
 * row names the file. Without the mount, or for a link that names no file,
 * the log is relayed from ringo as before.
 */
export class DeploysController extends ApplicationController {
  async index(): Promise<void> {
    this.noStore();
    const base = await Setting.ringoBase();
    let runs: DeployRow[] = [];
    let problem: string | null = base === null ? "no ringo origin is configured" : null;
    if (base !== null) {
      let response: Response | null = null;
      try {
        response = await fetch(`${base}/api/deploys`, { signal: AbortSignal.timeout(DEPLOYS_TIMEOUT_MS) });
      } catch (error) {
        problem = ringoFailure(error, DEPLOYS_TIMEOUT_MS).plain;
      }
      if (response !== null && !response.ok) {
        // The status alone: an error body may be a proxy's whole HTML page.
        problem = `ringo answered ${response.status}`;
      } else if (response !== null) {
        try {
          runs = (await response.json()) as DeployRow[];
        } catch {
          problem = "ringo answered, but not with the deploy history as JSON";
        }
      }
    }
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
    const file = String(this.params.get("file") ?? "");
    if (file !== "" && readsDeployLogLocally(file)) {
      // ringo answers a missing capture 200 with the reason as the text.
      await this.render({ plain: await readDeployLog(file) });
      return;
    }
    const base = await Setting.ringoBase();
    if (base === null) {
      await this.render({ plain: "no ringo origin is configured", status: 503 });
      return;
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

