import { ApplicationController } from "./application-controller.ts";
import { ringoFailure } from "./fleet-controller.ts";
import { Setting } from "../models/setting.ts";

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
  error?: string;
}

/**
 * `/deploys` and `/deploys/log?id=<run>`, read-only, beside ringo's own.
 *
 * Neither reads a model. The deploy history is ringo's `DeployStore`: a JSON
 * file on ringo's disk, and each run's log is the `pipe-pane` capture of the
 * tmux pane the deploy ran in, also a file on ringo's disk. trailmap has no
 * copy of either, so both are relayed from ringo over the private network, as
 * the fleet page's reads are. The rows are rendered here, in the order ringo
 * keeps them: newest first.
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
    await this.render({ locals: { runs, problem } });
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

