import { htmlSafe } from "@blazetrails/activesupport";
import { ApplicationController } from "./application-controller.ts";
import { SessionArchive, SessionArchiveUnavailable } from "../models/session-archive.ts";
import { Setting } from "../models/setting.ts";
import { archivePathProblem, readBounded, type BoundedRead } from "../../lib/archive-read.ts";
import { ringoFailure } from "../../lib/ringo-failure.ts";
import { parseTranscript, renderPaneLog } from "../../lib/ringo-core.ts";

/**
 * How long ringo has to hand over one archive file. Longer than the index's:
 * the largest pane log is ~100 MB, and the clock runs until the last byte.
 */
export const ARCHIVE_FILE_TIMEOUT_MS = 30_000;

/**
 * The most of one file `/sessions/file` relays and `/sessions/transcript` reads. A
 * file past it is refused rather than held whole: ringo, which reads its own
 * disk, still serves it.
 */
export const ARCHIVE_FILE_MAX_BYTES = 128 << 20;

/**
 * The most of a pane log `/sessions/pane` replays: the TAIL, as ringo's own
 * view keeps (`paneViewMaxBytes`), but a sixteenth of ringo's 32 MiB. The replay
 * is synchronous and holds the event loop while it runs, so this bound IS
 * the longest any other request waits behind it: 0.3–0.4 s, measured on the
 * tail of the archive's largest log (90 MB, 8.8 s replayed whole).
 */
export const PANE_VIEW_MAX_BYTES = 2 << 20;

/**
 * The most of a transcript `/sessions/transcript` parses: the HEAD, cut back to
 * the last whole line. `parseTranscript` is synchronous like the pane replay,
 * so this bound IS the longest any other request waits behind it. Measured
 * over the largest transcripts on the box (44–400 MB): 60–130 ms per MB, so
 * 4 MiB holds the loop for 0.3–0.5 s, where the old 128 MiB took 9 s.
 * `TRANSCRIPT_MAX_STEPS` does not help here: ringo reads every line either way.
 */
export const TRANSCRIPT_MAX_BYTES = 4 << 20;

/** The steps one transcript page draws, ringo's `ParseTranscript(src, 20000)`. */
export const TRANSCRIPT_MAX_STEPS = 20_000;

/** The scrollback rows kept, ringo's `RenderPaneLog(raw, 20000)`. */
export const PANE_VIEW_MAX_LINES = 20_000;

/**
 * `/sessions`, `/sessions/:owner/:repo/:pr` and `/api/sessions`, read-only,
 * beside ringo's own (`webhook/sessionarchive_page.go`).
 *
 * Enroll and backfill are not here: they are writes, and phase C of RFC 0136
 * is read-only. The three file reads the rows link to are: `file` relayed
 * from ringo, `transcript` and `pane` drawn here by ringo's own reader and
 * renderer (lib/ringo-core.ts).
 */
export class SessionsController extends ApplicationController {
  async index(): Promise<void> {
    this.noStore();
    let archives: SessionArchive[] = [];
    let problem: string | null = null;
    const status = SessionArchive.status();
    try {
      archives = await SessionArchive.all();
    } catch (error) {
      if (!(error instanceof SessionArchiveUnavailable)) throw error;
      problem = error.message;
    }
    await this.render({ locals: { archives, problem, status: await status, now: new Date() } });
  }

  /**
   * One PR's archives. An unknown PR is a 200 with "No archive recorded", not
   * a 404: that is what ringo's `servePR` answers, and this page matches it.
   */
  async show(): Promise<void> {
    this.noStore();
    const owner = String(this.params.get("owner") ?? "");
    const repo = String(this.params.get("repo") ?? "");
    const pr = Number(this.params.get("pr"));
    let archives: SessionArchive[] = [];
    let problem: string | null = null;
    try {
      archives = await SessionArchive.forPr({ owner, repo, pr });
    } catch (error) {
      if (!(error instanceof SessionArchiveUnavailable)) throw error;
      problem = error.message;
    }
    const timeline = archives.length > 0 ? await SessionArchive.timeline({ owner, repo, pr }) : null;
    await this.render({ locals: { owner, repo, pr, archives, timeline, problem, now: new Date() } });
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

  /** ringo's `HandleSessionFile`: one archive file, gunzipped, as plain text. */
  async file(): Promise<void> {
    this.noStore();
    const read = await this.readArchive("/sessions/file", ARCHIVE_FILE_MAX_BYTES, "head");
    if (read === null) return;
    if (read.truncated) return this.refuseTooLarge();
    const p = String(this.params.get("p") ?? "");
    const name = p.slice(p.lastIndexOf("/") + 1).replace(/\.gz$/, "");
    this.response.setHeader("Content-Disposition", `inline; filename="${name}"`);
    await this.render({ plain: new TextDecoder().decode(read.bytes) });
  }

  /**
   * ringo's `HandleTranscript`: the session read back into turns by ringo's
   * own `core.ParseTranscript` (lib/ringo-core.ts), drawn in this layout.
   */
  async transcript(): Promise<void> {
    this.noStore();
    const read = await this.readArchive("/sessions/file", TRANSCRIPT_MAX_BYTES, "head");
    if (read === null) return;
    // A half line is a JSON error to ringo's reader; end on the last whole one.
    const bytes = read.truncated ? read.bytes.subarray(0, read.bytes.lastIndexOf(0x0a) + 1) : read.bytes;
    const tr = await parseTranscript(bytes, TRANSCRIPT_MAX_STEPS);
    await this.render({
      locals: {
        p: String(this.params.get("p") ?? ""),
        tr,
        cut: read.truncated,
        // No newline in the whole head: its first line alone is past the bound.
        firstLineTooLong: read.truncated && bytes.length === 0,
        maxBytes: TRANSCRIPT_MAX_BYTES,
      },
    });
  }

  /**
   * ringo's `HandlePaneView`: a pane log replayed to its final scrollback.
   * The bytes are the log tmux writes through ringo's `pipe-pane`; nothing
   * here touches tmux.
   */
  async pane(): Promise<void> {
    this.noStore();
    const p = String(this.params.get("p") ?? "");
    // A transcript is a JSONL event log, not a terminal capture: ringo sends
    // it to the transcript page rather than replay JSON as scrollback.
    if (p.includes(".jsonl") && archivePathProblem(p) === null) {
      this.redirectTo(`/sessions/transcript?p=${encodeURIComponent(p)}`);
      return;
    }
    const read = await this.readArchive("/sessions/file", PANE_VIEW_MAX_BYTES, "tail");
    if (read === null) return;
    const { html, lines } = await renderPaneLog(read.bytes, PANE_VIEW_MAX_LINES);
    await this.render({
      locals: { p, name: p.slice(p.lastIndexOf("/") + 1), html: htmlSafe(html), lines, read, maxBytes: PANE_VIEW_MAX_BYTES },
    });
  }

  /**
   * Ask ringo for `path?p=`, bounded. `null` when the answer has already been
   * rendered: a refused path, no ringo, ringo down, or ringo's own refusal
   * (its status and text, as ringo's `http.Error` wrote them).
   */
  private async readArchive(path: string, max: number, keep: "head" | "tail"): Promise<BoundedRead | null> {
    const p = String(this.params.get("p") ?? "");
    const problem = archivePathProblem(p);
    if (problem !== null) {
      await this.render({ plain: problem, status: 400 });
      return null;
    }
    const base = await Setting.ringoBase();
    if (base === null) {
      await this.render({ plain: "no ringo origin is configured", status: 503 });
      return null;
    }
    try {
      const response = await fetch(`${base}${path}?p=${encodeURIComponent(p)}`, {
        signal: AbortSignal.timeout(ARCHIVE_FILE_TIMEOUT_MS),
        redirect: "manual",
      });
      if (!response.ok || response.body === null) {
        // ringo's refusals are one line of text; anything longer is a proxy's page.
        const text = (await response.text()).trim();
        await this.render({
          plain: text.length > 0 && text.length < 500 ? text : `ringo answered ${response.status}`,
          status: response.status >= 400 ? response.status : 502,
        });
        return null;
      }
      return await readBounded(response.body, max, keep);
    } catch (error) {
      await this.render(ringoFailure(error, ARCHIVE_FILE_TIMEOUT_MS));
      return null;
    }
  }

  private async refuseTooLarge(): Promise<void> {
    await this.render({
      plain: `larger than trailmap relays (${ARCHIVE_FILE_MAX_BYTES >> 20} MiB); ringo serves it whole`,
      status: 413,
    });
  }
}
