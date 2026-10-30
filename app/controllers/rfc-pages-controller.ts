import type { SafeBuffer } from "@blazetrails/activesupport";
import { ApplicationController } from "./application-controller.ts";
import { Event, Rfc, Story } from "../models/index.ts";
import { collectRfcMarks, type MarkEvent } from "../models/concerns/rfc-marks.ts";
import { readDocument } from "../models/concerns/document.ts";
import { rfcReadyDrafts, rfcStatusMoves, rfcStatusSet, type RfcStatusMove } from "../models/rfc-status.ts";
import { VerbExit } from "../models/verb-exit.ts";
import {
  orderRfcsForIndex,
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
 * (`app/assets/javascripts/rfc-actions.js`). What is still missing: the
 * refinements tab and the charts tab, each ringo's own local state.
 *
 * A missing RFC renders the page with a 404 rather than an error page — same
 * as ringo, and it is what makes a stale link say which id it was looking for.
 */
export class RfcPagesController extends ApplicationController {
  declare filter: string;
  declare total: number;
  declare tabs: { key: string; label: string; count: number; href: string; active: boolean }[];
  declare rows: RfcRow[];

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
    // Two columns, not the records: every figure on this page is a count of
    // statuses, and building 11,000 `Story` objects to read one field from
    // each was the whole second this page took.
    const [rfcs, statuses, history] = await Promise.all([
      Rfc.all().toArray(),
      Story.pluck("rfc_id", "status", "id"),
      // The two verbs the ticks are reconstructed from, oldest first.
      Event.where({ verb: ["new", "spawn"] })
        .order({ at: "asc", id: "asc" })
        .pluck("at", "verb", "story_id", "rfc_id", "detail"),
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
    const openCount = new Map<string, number>();
    for (const rfc of rfcs) {
      tabCounts.set(rfc.status, (tabCounts.get(rfc.status) ?? 0) + 1);
      openCount.set(rfc.id, rfcStoryCounts(byRfc.get(rfc.id) ?? []).open);
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
    const marks = collectRfcMarks(new Set(rfcs.map((rfc) => rfc.id)), storyRfc, events);

    const requested = String(this.params.get("status") ?? "");
    const filter = RFC_STATUS_TABS.includes(requested) ? requested : "active";
    const shown = orderRfcsForIndex(rfcs.filter((rfc) => rfc.status === filter), openCount);

    this.filter = filter;
    this.total = rfcs.length;
    this.tabs = RFC_STATUS_TABS.map((status) => ({
      key: status,
      label: status,
      count: tabCounts.get(status) ?? 0,
      href: this.rfcsPath({ status }),
      active: status === filter,
    }));
    this.rows = shown.map((rfc) =>
      rfcListRow(rfc, byRfc.get(rfc.id) ?? [], heldByRfc.get(rfc.id), marks.get(rfc.id) ?? [], barScale),
    );
  }

  async show(): Promise<void> {
    await this.loadShow(String(this.params.get("id") ?? ""));
    if (this.rfc === null) await this.render({ action: "show", status: 404 });
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
    if (rfc === null) return this.renderShow(id, null, 404);
    if (!rfcStatusMoves(rfc.status).some((move) => move.to === to)) {
      return this.renderShow(id, `rfc ${id} is "${rfc.status}"; cannot move it to "${to}"`, 409);
    }
    const reason = this.params.get("reason");
    await this.mutate(id, () => rfcStatusSet(id, to, { reason: reason == null ? null : String(reason) }));
  }

  /** `POST /rfc/<id>/ready-drafts` — "Mark drafts ready", ringo's `HandleRFCReadyDrafts`. */
  async readyDrafts(): Promise<void> {
    const id = String(this.params.get("id") ?? "");
    await this.mutate(id, () => rfcReadyDrafts(id));
  }

  private async mutate(id: string, body: () => Promise<unknown>): Promise<void> {
    try {
      await body();
    } catch (error) {
      if (!(error instanceof VerbExit)) throw error;
      return this.renderShow(id, error.message, error.code === 1 ? 422 : 409);
    }
    this.redirectTo(this.rfcPath(id), { status: 303 });
  }

  /** `/rfc/<id>` again, carrying a refusal or a not-found. */
  private async renderShow(id: string, refusal: string | null, code: number): Promise<void> {
    this.refusal = refusal;
    await this.loadShow(id);
    await this.render({ action: "show", status: this.rfc === null ? 404 : code });
  }

  private async loadShow(id: string): Promise<void> {
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
  }
}
