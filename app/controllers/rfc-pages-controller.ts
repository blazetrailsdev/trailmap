import type { SafeBuffer } from "@blazetrails/activesupport";
import { ApplicationController } from "./application-controller.ts";
import { Event } from "../models/event.ts";
import { Rfc } from "../models/rfc.ts";
import { Story } from "../models/story.ts";
import { RfcRefine } from "../models/rfc-refine.ts";
import { collectRfcMarks, type MarkEvent, type RefineReport } from "../models/concerns/rfc-marks.ts";
import { readDocument } from "../models/concerns/document.ts";
import { rfcReadyDrafts, rfcStatusMoves, rfcStatusSet, type RfcStatusMove } from "../models/rfc-status.ts";
import { VerbExit } from "../models/verb-exit.ts";
import {
  RFC_INDEX_SORTS,
  sortRfcsForIndex,
  orderStoriesForRfc,
  rfcStoryCounts,
  storyBarScale,
  type RfcStoryCounts,
} from "../models/concerns/rfc-progress.ts";
import { renderMarkdown } from "../helpers/markdown-helper.ts";
import { rfcListRow, rfcStoryRow, type RfcRow, type RfcStoryRow } from "../helpers/rfc-pages-helper.ts";

/**
 * The status tabs, in ringo's order (`STATUS_ORDER`, webhook/rfcs.go). Active
 * is first because it is the default view and the only one anyone works from.
 */
const RFC_STATUS_TABS: readonly string[] = ["active", "draft", "postponed", "closed", "superseded"];

/**
 * `/rfc/<id>` — the RFC show page.
 *
 * One of the first two pages trailmap serves from real data, and a port of
 * ringo's `HandleRFCPage` (`webhook/rfcs.go:174`): the RFC's metadata, its
 * stories with a done count, and its rendered markdown. ringo keeps serving
 * its own copy until this one is verified against it, so nothing here
 * replaces anything yet.
 *
 * The lifecycle buttons — draft / ready / postpone / close, and "Mark drafts
 * ready" — are ported (`move`, `readyDrafts`, app/models/rfc-status.ts).
 * "Spawn batch", "Refine stories" and "Sunset" start an agent, which is ringo's
 * dispatch and not a database write, so they are NOT ported: the page posts
 * them through the `fleet/control` relay to ringo
 * (`app/assets/javascripts/rfc-actions.js`). The Refinements tab
 * (`/rfc/<id>/refinements`) reads the refine reports trailmap stores in the
 * hub (`RfcRefine`); ringo kept only the newest, in a local file. What is
 * still missing: the charts tab.
 *
 * A missing RFC renders the page with a 404 rather than an error page — same
 * as ringo, and it is what makes a stale link say which id it was looking for.
 */
export class RfcPagesController extends ApplicationController {
  declare filter: string;
  declare total: number;
  declare tabs: { key: string; label: string; count: number; href: string; active: boolean }[];
  declare rows: RfcRow[];
  declare sort: string;
  declare sorts: { key: string; label: string; title: string; href: string; active: boolean }[];

  rfcId = "";
  rfc: Rfc | null = null;
  stories: RfcStoryRow[] = [];
  counts: RfcStoryCounts | null = null;
  // Not `body` or `error`: the first is the response's, here as in Rails.
  html: SafeBuffer | null = null;
  documentError = "";
  moves: RfcStatusMove[] = [];
  hasDrafts = false;
  canBatch = false;
  canSunset = false;
  refusal: string | null = null;
  tab: "stories" | "refinements" = "stories";
  refineCount: number | null = null;
  refines: { at: string; outcome: string; html: SafeBuffer | null }[] = [];

  /**
   * `/rfcs` — the RFC list, server-rendered.
   *
   * ringo prints a constant shell here and lets the browser fetch
   * `/spawnloop/rfcs` and assemble the rows (`HandleRFCsPage`,
   * webhook/rfcs.go:164), so this is a port of the SCRIPT rather than of a
   * handler: the rows, the counts, the ordering and the status tabs all come
   * out of `draw()`. The one structural change that follows from rendering on
   * the server is the tabs — they were a client-side filter over one fetched
   * dataset and are now links (`/rfcs?status=draft`), because a tab that
   * needs JavaScript to change what the page shows is exactly the client-side
   * assembly this story removes.
   *
   * The two signals the port first left behind are here, each from this
   * database: "needs refine" is `rfcStalled`, a count of the RFC's statuses,
   * and the bar's history ticks are `collectRfcMarks`, over the `events`
   * table. The refine button is on `/rfc/<id>`.
   *
   * The counts are the show page's: `rfcStoryCounts` decides done/total here
   * and there, so an RFC cannot report 12/20 on one page and 12/21 on the
   * other.
   */
  async index(): Promise<void> {
    // The default sort stays off the URL, as rfc-sort.js keeps it off with
    // JavaScript: a no-JS submit of the sort menu lands on the bare address.
    if (this.params.get("sort") === "priority") {
      const status = this.params.get("status");
      this.redirectTo(this.rfcsPath(typeof status === "string" && status ? { status } : {}));
      return;
    }
    // Two columns, not the records: every figure on this page is a count of
    // statuses, and building 11,000 `Story` objects to read one field from
    // each was the whole second this page took.
    const [rfcs, statuses, history, refineRows] = await Promise.all([
      Rfc.all().toArray(),
      Story.pluck("rfc_id", "status", "id"),
      // The two verbs the ticks are reconstructed from, oldest first.
      Event.where({ verb: ["new", "spawn"] })
        .order({ at: "asc", id: "asc" })
        .pluck("at", "verb", "story_id", "rfc_id", "detail"),
      // Records, not `pluck`: a record's `created_at` is typed as a time.
      RfcRefine.select("rfc_id", "created_at").toArray(),
    ]);

    const byRfc = new Map<string, (string | null)[]>();
    const heldByRfc = new Map<string, boolean[]>();
    const storyRfc = new Map<string, string>();
    const held = await Story.depHeldIds();
    for (const row of statuses) {
      if (!Array.isArray(row)) continue;
      const [rfcId, status, id] = row;
      storyRfc.set(String(id), String(rfcId));
      const bucket = byRfc.get(String(rfcId));
      const value = status == null ? null : String(status);
      if (bucket) bucket.push(value);
      else byRfc.set(String(rfcId), [value]);
      const heldBucket = heldByRfc.get(String(rfcId)) ?? [];
      heldBucket.push(held.has(String(id)));
      heldByRfc.set(String(rfcId), heldBucket);
    }

    const tabCounts = new Map<string, number>();
    const storyCounts = new Map<string, RfcStoryCounts>();
    for (const rfc of rfcs) {
      tabCounts.set(rfc.status, (tabCounts.get(rfc.status) ?? 0) + 1);
      storyCounts.set(rfc.id, rfcStoryCounts(byRfc.get(rfc.id) ?? []));
    }

    // Over every RFC, not the tab's: the scale must not move when the tab does.
    const barScale = storyBarScale(rfcs.map((rfc) => byRfc.get(rfc.id)?.length ?? 0));
    const events = history.filter(Array.isArray).map(
      ([at, verb, storyId, rfcId, detail]): MarkEvent => ({
        at: String(at),
        verb: String(verb),
        storyId: storyId == null ? null : String(storyId),
        rfcId: rfcId == null ? null : String(rfcId),
        detail: detail == null ? null : String(detail),
      }),
    );
    const reports = refineRows.map(
      (row): RefineReport => ({ rfcId: row.rfc_id, at: row.created_at.utc().iso8601() }),
    );
    const marks = collectRfcMarks(new Set(rfcs.map((rfc) => rfc.id)), storyRfc, events, reports);

    const requested = String(this.params.get("status") ?? "");
    const filter = RFC_STATUS_TABS.includes(requested) ? requested : "active";
    const requestedSort = String(this.params.get("sort") ?? "");
    const sort = RFC_INDEX_SORTS.some((option) => option.key === requestedSort) ? requestedSort : "priority";
    const shown = sortRfcsForIndex(
      rfcs.filter((rfc) => rfc.status === filter),
      sort,
      storyCounts,
    );
    // The default is left off a URL, so `/rfcs` stays the canonical address.
    const sortParam = sort === "priority" ? {} : { sort };

    this.filter = filter;
    this.sort = sort;
    this.sorts = RFC_INDEX_SORTS.map((option) => ({
      ...option,
      href: this.rfcsPath({ status: filter, ...(option.key === "priority" ? {} : { sort: option.key }) }),
      active: option.key === sort,
    }));
    this.total = rfcs.length;
    this.tabs = RFC_STATUS_TABS.map((status) => ({
      key: status,
      label: status,
      count: tabCounts.get(status) ?? 0,
      href: this.rfcsPath({ status, ...sortParam }),
      active: status === filter,
    }));
    this.rows = shown.map((rfc) =>
      rfcListRow(rfc, byRfc.get(rfc.id) ?? [], heldByRfc.get(rfc.id), marks.get(rfc.id) ?? [], barScale),
    );
  }

  async show(): Promise<void> {
    await this._loadShow(String(this.params.get("id") ?? ""));
    if (this.rfc === null) await this.render({ action: "show", status: 404 });
  }

  /**
   * `/rfc/<id>/refinements` — ringo's Refinements tab: the newest refine
   * report (when, outcome, the summary rendered), then the earlier ones,
   * newest first. An unknown id is the same 404 as the Stories tab.
   */
  async refinements(): Promise<void> {
    this.tab = "refinements";
    await this._loadShow(String(this.params.get("id") ?? ""));
    if (this.rfc === null) {
      await this.render({ action: "show", status: 404 });
      return;
    }
    const rows = await RfcRefine.forRfc(this.rfc.id).toArray();
    this.refines = rows.map((row) => ({
      at: row.created_at.utc().iso8601(3),
      outcome: row.outcome,
      html: row.summary === "" ? null : renderMarkdown(row.summary),
    }));
    this.refineCount = rows.length;
    await this.render({ action: "show" });
  }

  /**
   * `POST /rfc/<id>/status` — the lifecycle buttons, ringo's `HandleRFCStatus`.
   * Only a move `rfcStatusMoves` offers is made, with ringo's 409 refusal;
   * the rest of the rules and messages are the CLI's (`rfcStatusSet`).
   *
   * A move that lands redirects back to the page (303), so a reload does not
   * repeat it. A refusal renders the page with the message, as ringo's
   * button showed its error body.
   */
  async move(): Promise<void> {
    const id = String(this.params.get("id") ?? "");
    const to = String(this.params.get("status") ?? "");
    const rfc = await Rfc.findBy({ id });
    if (rfc === null) return this._renderShow(id, null, 404);
    if (!rfcStatusMoves(rfc.status).some((move) => move.to === to)) {
      return this._renderShow(id, `rfc ${id} is "${rfc.status}"; cannot move it to "${to}"`, 409);
    }
    const reason = this.params.get("reason");
    await this._mutate(id, () => rfcStatusSet(id, to, { reason: reason == null ? null : String(reason) }));
  }

  /**
   * `POST /rfc/<id>/priority` — ringo's RFC-page priority control, the CLI's
   * `rfc-priority <rfc> <n|clear>`. A blank field or `clear` clears it.
   */
  async priority(): Promise<void> {
    const id = String(this.params.get("id") ?? "");
    const rfc = await Rfc.findBy({ id });
    if (rfc === null) return this._renderShow(id, null, 404);
    const raw = String(this.params.get("priority") ?? "").trim();
    const priority = raw === "" || raw === "clear" ? null : /^\d+$/.test(raw) ? Number(raw) : NaN;
    await this._mutate(id, () => rfc.prioritySet(priority));
  }

  /** `POST /rfc/<id>/ready-drafts` — "Mark drafts ready", ringo's `HandleRFCReadyDrafts`. */
  async readyDrafts(): Promise<void> {
    const id = String(this.params.get("id") ?? "");
    await this._mutate(id, () => rfcReadyDrafts(id));
  }

  private async _mutate(id: string, body: () => Promise<unknown>): Promise<void> {
    try {
      await body();
    } catch (error) {
      if (!(error instanceof VerbExit)) throw error;
      return this._renderShow(id, error.message, error.code === 1 ? 422 : 409);
    }
    await this.redirectTo(this.rfcPath(id), { status: 303 });
  }

  /** `/rfc/<id>` again, carrying a refusal or a not-found. */
  private async _renderShow(id: string, refusal: string | null, code: number): Promise<void> {
    this.refusal = refusal;
    await this._loadShow(id);
    await this.render({ action: "show", status: this.rfc === null ? 404 : code });
  }

  private async _loadShow(id: string): Promise<void> {
    this.rfcId = id;
    const rfc = id === "" ? null : await Rfc.findBy({ id });
    this.rfc = rfc;
    if (rfc === null) return;

    const own = await Story.where({ rfc_id: id }).toArray();
    const held = await Story.depHeldIds(own.map((story) => story.id));
    const stories = orderStoriesForRfc(own, rfc.status, held);
    const doc = await readDocument(rfc.file_path);
    this.stories = stories.map((story) => rfcStoryRow(story, rfc.status, held));
    // Counted from the records, not the rows: `rfcStoryCounts` decides
    // done/total, and the override only ever moves `ready` to `draft` —
    // neither of which it counts.
    this.counts = rfcStoryCounts(stories.map((story) => story.status));
    this.html = doc.markdown === "" ? null : renderMarkdown(doc.markdown);
    this.documentError = doc.error;
    this.moves = rfcStatusMoves(rfc.status);
    this.hasDrafts = own.some((story) => story.status === "draft");
    // What ringo's batch could pick up, as its page counts it (`BatchCount`,
    // webhook/rfcs.go): ready and not dep-held, or a draft under a draft RFC.
    this.canBatch = own.some(
      (story) =>
        (story.status === "ready" && !held.has(story.id)) || (rfc.status === "draft" && story.status === "draft"),
    );
    // A sunset winds down an active RFC; the others are iceboxed or ended.
    this.canSunset = rfc.status === "active";
    // The tab bar counts the reports on both tabs, as ringo's does; the
    // Refinements tab sets it from the rows it loads.
    if (this.tab === "stories") this.refineCount = await RfcRefine.where({ rfc_id: id }).count();
  }
}
