import type { SafeBuffer } from "@blazetrails/activesupport";
import { ApplicationController } from "./application-controller.ts";
import { Event, Rfc, Story } from "../models/index.ts";
import { collectRfcMarks, markTitle, type MarkEvent } from "../models/concerns/rfc-marks.ts";
import { readDocument } from "../models/concerns/document.ts";
import { rfcReadyDrafts, rfcStatusMoves, rfcStatusSet, type RfcStatusMove } from "../models/rfc-status.ts";
import { VerbExit } from "../models/verb-exit.ts";
import { shownStoryStatus } from "../models/concerns/effective-status.ts";
import {
  orderRfcsForIndex,
  orderStoriesForRfc,
  rfcStalled,
  rfcStoryCounts,
  rfcTerminal,
  storyBarLength,
  storyBarScale,
  storyStatusCounts,
  type RfcStoryCounts,
  type StatusCount,
  type StoryBarLength,
} from "../models/concerns/rfc-progress.ts";
import { daysSince } from "../models/concerns/elapsed.ts";
import { renderMarkdown } from "../helpers/markdown-helper.ts";

/**
 * The status tabs, in ringo's order (`STATUS_ORDER`, webhook/rfcs.go). Active
 * is first because it is the default view and the only one anyone works from.
 */
const RFC_STATUS_TABS: readonly string[] = ["active", "draft", "postponed", "closed", "superseded"];

/**
 * One story on an RFC's show page, assembled here because a `.tse` cannot
 * compute — the same reason `RfcRow` and `BacklogRow` exist.
 */
export interface RfcStoryRow {
  id: string;
  title: string;
  /**
   * The EFFECTIVE status, not the authored one: a `ready` story under a
   * non-active RFC is a `draft` (`effectiveStoryStatus`), which is what ringo
   * shows and what `orderStoriesForRfc` ranks this row by. Showing the
   * authored status here would have the page sort a story as a draft while
   * labelling it ready, and would tell a reader it is claimable when the
   * queue will not offer it.
   */
  status: string;
  estLoc: number | null;
  cluster: string | null;
  priority: number | null;
}

/** One row of the RFC list, assembled here because a `.tse` cannot compute. */
export interface RfcRow {
  id: string;
  title: string;
  owner: string | null;
  priority: number | null;
  supersededBy: string | null;
  clusters: string[];
  counts: RfcStoryCounts;
  bar: StatusCount[];
  /** How long the bar is drawn: its story count against every RFC's. */
  barLength: StoryBarLength;
  /** Active, with nothing ready or in flight: `rfcStalled`. */
  stalled: boolean;
  /** The bar's history, as positions along its track. */
  ticks: { kind: string; pct: number; title: string }[];
  storyTotal: number;
  /** Days since the RFC was written, or null when it is terminal or undated. */
  openDays: number | null;
}

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
 * "Spawn batch" and "Sunset" start an agent, which is ringo's dispatch and
 * not a database write, so they are NOT ported: the page posts them through
 * the `fleet/control` relay to ringo (`app/assets/javascripts/rfc-actions.js`).
 * What is still missing: refine, the refinements tab and the charts tab, each
 * ringo's own local state.
 *
 * A missing RFC renders the page with a 404 rather than an error page — same
 * as ringo, and it is what makes a stale link say which id it was looking for.
 */
export class RfcPagesController extends ApplicationController {
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
   * table. What stays ringo's is the refine BUTTON, a dispatch.
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

    await this.render({
      locals: {
        filter,
        total: rfcs.length,
        tabs: RFC_STATUS_TABS.map((status) => ({
          key: status,
          label: status,
          count: tabCounts.get(status) ?? 0,
          href: `/rfcs?status=${status}`,
          active: status === filter,
        })),
        rows: shown.map((rfc): RfcRow => {
          const own = byRfc.get(rfc.id) ?? [];
          const barLength = storyBarLength(own.length, barScale);
          return {
            id: rfc.id,
            title: rfc.title ?? rfc.id,
            owner: rfc.owner,
            priority: rfc.priority,
            supersededBy: rfc.superseded_by,
            clusters: rfc.clusters,
            counts: rfcStoryCounts(own),
            bar: storyStatusCounts(own, rfc.status, heldByRfc.get(rfc.id)),
            barLength,
            stalled: rfcStalled(rfc.status, own),
            // A tick at the bar's own end says nothing and smears the tip.
            ticks: (marks.get(rfc.id) ?? [])
              .filter((mark) => mark.count > 0)
              .map((mark) => ({
                kind: mark.kind,
                pct: storyBarLength(mark.count, barScale).pct,
                title: markTitle(mark),
              }))
              .filter((tick) => Math.abs(tick.pct - barLength.pct) >= 0.5),
            storyTotal: own.length,
            openDays: rfcTerminal(rfc.status) ? null : daysSince(rfc.created_on),
          };
        }),
      },
    });
  }

  async show(): Promise<void> {
    await this.renderShow(String(this.params.get("id") ?? ""), null, 200);
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
    this.redirectTo(`/rfc/${id}`, { status: 303 });
  }

  private async renderShow(id: string, refusal: string | null, code: number): Promise<void> {
    const rfc = id === "" ? null : await Rfc.findBy({ id });
    if (rfc === null) {
      await this.renderPage({ id, rfc: null, stories: [], counts: null, refusal }, 404);
      return;
    }

    const own = await Story.where({ rfc_id: id }).toArray();
    const held = await Story.depHeldIds(own.map((story) => story.id));
    const stories = orderStoriesForRfc(own, rfc.status, held);
    const doc = await readDocument(rfc.file_path);
    await this.renderPage(
      {
        id,
        rfc,
        stories: stories.map(
          (story): RfcStoryRow => ({
            id: story.id,
            title: story.title ?? story.id,
            status: shownStoryStatus(rfc.status, story.status, held.has(story.id)) ?? "",
            estLoc: story.est_loc,
            cluster: story.cluster,
            priority: story.priority,
          }),
        ),
        // Counted from the records, not the rows: `rfcStoryCounts` decides
        // done/total, and the override only ever moves `ready` to `draft` —
        // neither of which it counts.
        counts: rfcStoryCounts(stories.map((story) => story.status)),
        body: doc.markdown === "" ? null : renderMarkdown(doc.markdown),
        error: doc.error,
        moves: rfcStatusMoves(rfc.status),
        hasDrafts: own.some((story) => story.status === "draft"),
        // What ringo's batch could pick up, as its page counts it (`BatchCount`,
        // webhook/rfcs.go): ready and not dep-held, or a draft under a draft RFC.
        canBatch: own.some(
          (story) =>
            (story.status === "ready" && !held.has(story.id)) || (rfc.status === "draft" && story.status === "draft"),
        ),
        // A sunset winds down an active RFC; the others are iceboxed or ended.
        canSunset: rfc.status === "active",
        refusal,
      },
      code,
    );
  }

  /** `/rfc/<id>`, or the same page carrying a not-found or error message. */
  private async renderPage(locals: Record<string, unknown>, status: number): Promise<void> {
    await this.render({
      action: "show",
      locals: { body: null as SafeBuffer | null, error: "", moves: [] as RfcStatusMove[], hasDrafts: false, canBatch: false, canSunset: false, ...locals },
      status,
    });
  }
}
