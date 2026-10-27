import { ApplicationController } from "./application-controller.ts";
import { SessionArchive, SessionArchiveUnavailable } from "../models/session-archive.ts";

/**
 * `/sessions`, `/sessions/:owner/:repo/:pr` and `/api/sessions`, read-only,
 * beside ringo's own (`webhook/sessionarchive_page.go`).
 *
 * Enroll and backfill are not here: they are writes, and phase C of RFC 0136
 * is read-only. Nor are the pane-log and transcript viewers the rows link to;
 * those links go to ringo's, until `port-the-pane-terminal-emulator` lands.
 */
export class SessionsController extends ApplicationController {
  async index(): Promise<void> {
    this.noStore();
    let archives: SessionArchive[] = [];
    let problem: string | null = null;
    try {
      archives = await SessionArchive.all();
    } catch (error) {
      if (!(error instanceof SessionArchiveUnavailable)) throw error;
      problem = error.message;
    }
    await this.render({ locals: { archives, problem, now: new Date() } });
  }

  async show(): Promise<void> {
    this.noStore();
    const owner = String(this.params.get("owner") ?? "");
    const repo = String(this.params.get("repo") ?? "");
    const pr = Number(this.params.get("pr"));
    let archives: SessionArchive[] = [];
    let problem: string | null = null;
    try {
      archives = await SessionArchive.where({ owner, repo, pr });
    } catch (error) {
      if (!(error instanceof SessionArchiveUnavailable)) throw error;
      problem = error.message;
    }
    await this.render({ locals: { owner, repo, pr, archives, problem, now: new Date() } });
  }

  /** ringo's `HandleSessionsAPI`: the index as JSON, in ringo's own shape. */
  async api(): Promise<void> {
    this.noStore();
    try {
      const archives = await SessionArchive.all();
      await this.render({ json: archives.map((a) => a.row) });
    } catch (error) {
      if (!(error instanceof SessionArchiveUnavailable)) throw error;
      await this.render({ plain: error.message, status: error.status });
    }
  }
}
