import { ApplicationController } from "./application-controller.js";
import { requireLoopback } from "./concerns/loopback-only.js";
import { Event, Rfc, Story } from "../models/index.js";
import { serializeStories } from "../serializers/story-json.js";
import { serializeRfcs } from "../serializers/rfc-json.js";

/**
 * The two read-models `index.json` and `events.json` carried, served whole.
 *
 * These exist for ONE consumer: ringo, whose hand-written Go read model
 * (webhook/tasksdb.go) is deleted in the same change. It read the whole index
 * on every page and the whole event stream for every chart, so a per-verb API
 * would have it making five calls to rebuild something it already knows how to
 * unmarshal in one. Serving the identical shapes means the Go structs — which
 * parsed `index.json` — need no field changes at all.
 *
 * No content negotiation and no HTML half, unlike the read verbs: nothing here
 * is a page, and no browser is the audience. The loopback guard still applies,
 * because this is the same API surface.
 */
export class ReadModelsController extends ApplicationController {
  static {
    this.beforeAction(requireLoopback);
  }

  /**
   * `index.json`: every RFC and every story.
   *
   * ORDERING IS PART OF THE ANSWER. RFCs go out by id and stories by
   * (priority, id) — `rankingIndex()` has already applied the story sort, and
   * the spawn loop consumes this order as the ready-queue ranking, so a
   * response in whatever order SQLite returned would silently reorder the
   * queue without changing its membership.
   */
  async index(): Promise<void> {
    const snapshot = await Story.rankingRows();
    const rfcs = await Rfc.order({ id: "asc" }).toArray();
    await this.render({
      json: { rfcs: serializeRfcs(rfcs), stories: serializeStories(snapshot.stories, snapshot) },
    });
  }

  /**
   * `events.json`: the append-only stream, chronological — the order both
   * chart collectors walk. `id` breaks ties on `at`, which is only
   * second-resolution, so a burst of verbs in one second keeps its real order.
   */
  async events(): Promise<void> {
    const rows = await Event.order({ at: "asc", id: "asc" }).toArray();
    await this.render({
      json: {
        events: rows.map((event) => ({
          at: String(event.at),
          verb: event.verb,
          story: event.story_id ?? null,
          rfc: event.rfc_id ?? null,
          pr: event.pr ?? null,
          actor: event.actor ?? null,
          detail: event.detail ?? null,
        })),
      },
    });
  }
}
