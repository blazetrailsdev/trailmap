import { Attributes, Model, type AttributesClassHalf } from "@blazetrails/activemodel";
import { include } from "@blazetrails/activesupport";
import { ringoFailure } from "../../lib/ringo-failure.ts";
import { Setting } from "./setting.ts";

/**
 * How long ringo has to answer for the archive index. A page load waits on it,
 * and ringo answers from memory.
 */
export const SESSIONS_TIMEOUT_MS = 5_000;

/** One pinned transcript, as ringo's `ArchivedTranscript` marshals it. */
export interface ArchivedTranscriptRow {
  session_id: string;
  path: string;
  bytes: number;
  first_at: string;
  last_at: string;
  branch?: string;
  role?: string;
  cwd?: string;
  user_turns?: number;
  cost?: number;
}

/** One row of ringo's `/api/sessions`, as `SessionArchive` marshals it. */
export interface SessionArchiveRow {
  owner: string;
  repo: string;
  pr: number;
  pane: string;
  branch?: string;
  cwd?: string;
  opened_at: string;
  closed_at?: string;
  reason?: string;
  pane_log?: string;
  pane_log_bytes?: number;
  truncated?: boolean;
  transcripts?: ArchivedTranscriptRow[];
}

/**
 * ringo's `/api/sessions/status`: `SessionStore.Status()`, `Mode()` and
 * `UnclaimedPaneLogs()`, the two notes ringo's own index prints above and
 * below the table. `note` is empty when the archive is fully on.
 */
export interface SessionArchiveStatus {
  mode: string;
  note: string;
  unclaimed_pane_logs: number;
  unclaimed_pane_log_bytes: number;
}

/** ringo had nothing to say: no note, nothing unclaimed. Neither note is printed. */
export const NO_ARCHIVE_STATUS: SessionArchiveStatus = Object.freeze({
  mode: "",
  note: "",
  unclaimed_pane_logs: 0,
  unclaimed_pane_log_bytes: 0,
});

/** The archive could not be read: ringo is unset, down, or answered something else. */
export class SessionArchiveUnavailable extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SessionArchiveUnavailable";
    this.status = status;
  }
}

/**
 * One pane's working life on one PR — ringo's `SessionArchive`
 * (`webhook/sessionarchive.go`).
 *
 * An ActiveModel, not an ActiveRecord: the archive is ringo's `index.json` and
 * the files beside it, on ringo's disk, so `all` reads it over the private
 * network from ringo's `/api/sessions` as the deploys page does. The finders
 * carry ringo's names (`all`, `forPr` for `ForPR`), not AR's, since they
 * return arrays rather than relations, and the
 * row ringo sent is kept verbatim so `/api/sessions` relays its shape exactly.
 */
export class SessionArchive extends Model {
  declare static attribute: AttributesClassHalf["attribute"];
  declare owner: string;
  declare repo: string;
  declare pr: number;
  declare pane: string;
  declare branch: string;
  declare cwd: string;
  declare reason: string;
  declare paneLog: string;
  declare paneLogBytes: number;
  declare truncated: boolean;

  static {
    include(this, Attributes);
    this.attribute("owner", "string");
    this.attribute("repo", "string");
    this.attribute("pr", "integer");
    this.attribute("pane", "string");
    this.attribute("branch", "string", { default: "" });
    this.attribute("cwd", "string", { default: "" });
    this.attribute("reason", "string", { default: "" });
    this.attribute("paneLog", "string", { default: "" });
    this.attribute("paneLogBytes", "integer", { default: 0 });
    this.attribute("truncated", "boolean", { default: false });
  }

  /** ringo's row, untouched. */
  row!: SessionArchiveRow;

  static fromRow(row: SessionArchiveRow): SessionArchive {
    const archive = new SessionArchive({
      owner: row.owner,
      repo: row.repo,
      pr: row.pr,
      pane: row.pane,
      branch: row.branch ?? "",
      cwd: row.cwd ?? "",
      reason: row.reason ?? "",
      paneLog: row.pane_log ?? "",
      paneLogBytes: row.pane_log_bytes ?? 0,
      truncated: row.truncated ?? false,
    });
    archive.row = row;
    return archive;
  }

  /**
   * Every archive in ringo's `List` order: open panes newest-opened first,
   * then closed ones most recently closed first. The order is ringo's, kept.
   */
  static async all(): Promise<SessionArchive[]> {
    const base = await Setting.ringoBase();
    if (base === null) throw new SessionArchiveUnavailable("no ringo origin is configured", 503);
    let response: Response;
    try {
      response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(SESSIONS_TIMEOUT_MS) });
    } catch (error) {
      const failure = ringoFailure(error, SESSIONS_TIMEOUT_MS);
      throw new SessionArchiveUnavailable(failure.plain, failure.status);
    }
    // The status alone: an error body may be a proxy's whole HTML page.
    if (!response.ok) throw new SessionArchiveUnavailable(`ringo answered ${response.status}`, 502);
    let rows: SessionArchiveRow[] | null;
    try {
      rows = (await response.json()) as SessionArchiveRow[] | null;
    } catch {
      throw new SessionArchiveUnavailable("ringo answered, but not with the session archive as JSON", 502);
    }
    // Go encodes an empty archive's nil slice as `null`.
    return (rows ?? []).map((row) => SessionArchive.fromRow(row));
  }

  /**
   * The archive's mode note and unclaimed-capture count — `NO_ARCHIVE_STATUS`
   * when ringo cannot say: unset, down, or a ringo from before the endpoint.
   * Only two notes hang on it, so `all()` reports the failure and this stays quiet.
   */
  static async status(): Promise<SessionArchiveStatus> {
    const base = await Setting.ringoBase();
    if (base === null) return NO_ARCHIVE_STATUS;
    try {
      const response = await fetch(`${base}/api/sessions/status`, { signal: AbortSignal.timeout(SESSIONS_TIMEOUT_MS) });
      if (!response.ok) return NO_ARCHIVE_STATUS;
      return { ...NO_ARCHIVE_STATUS, ...((await response.json()) as Partial<SessionArchiveStatus>) };
    } catch {
      return NO_ARCHIVE_STATUS;
    }
  }

  /** ringo's `ForPR`: every archive recorded against one PR, one per pane. */
  static async forPr({ owner, repo, pr }: { owner: string; repo: string; pr: number }): Promise<SessionArchive[]> {
    return (await this.all()).filter((a) => a.owner === owner && a.repo === repo && a.pr === pr);
  }

  get transcripts(): ArchivedTranscriptRow[] {
    return this.row.transcripts ?? [];
  }

  get openedAt(): Date {
    return new Date(this.row.opened_at);
  }

  /** Go writes a zero `time.Time` for an open archive: `0001-01-01T00:00:00Z`. */
  get closedAt(): Date | null {
    const at = this.row.closed_at;
    if (!at || at.startsWith("0001-")) return null;
    return new Date(at);
  }

  /** ringo's `Open`: still accumulating. */
  isOpen(): boolean {
    return this.closedAt === null;
  }

  /** ringo's `Duration`, in milliseconds: until now for an open archive. */
  duration(now: Date = new Date()): number {
    return (this.closedAt ?? now).getTime() - this.openedAt.getTime();
  }

  /** ringo's `Cost`: the pinned transcripts' cost, summed. */
  get cost(): number {
    return this.transcripts.reduce((sum, t) => sum + (t.cost ?? 0), 0);
  }

  /**
   * ringo's `roleSplit`, as numbers: distinct runners per role (keyed on the
   * checkout, or the session before CWD was recorded) and the passes they made.
   */
  roleSplit(): { agents: number; reviewers: number; passes: number } {
    const agents = new Set<string>();
    const reviewers = new Set<string>();
    let passes = 0;
    for (const t of this.transcripts) {
      const key = t.cwd || t.session_id;
      if (t.role === "reviewer") {
        reviewers.add(key);
        passes++;
      } else if (t.role === "agent") {
        agents.add(key);
        passes++;
      }
    }
    return { agents: agents.size, reviewers: reviewers.size, passes };
  }
}
