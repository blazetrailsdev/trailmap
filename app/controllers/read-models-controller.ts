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
   *
   * PLUCKED, not loaded. The stream is the whole table — 59,491 rows and 11 MB
   * on the live database — and nothing here needs a record: seven columns go
   * straight into seven keys. Measured there, in milliseconds:
   *
   *     query alone                       ~60
   *     building 59k `Event` records    ~1,600
   *     reading seven attributes each     ~550
   *     JSON.stringify                     ~80
   *
   * so nine tenths of the response was record building, and `pluck` — which
   * still casts each column through its type, so `at` reads as it did —
   * answers in ~110 with the same bytes. `EVENT_COLUMNS` and the destructuring
   * below are one list in one order; the test compares against the records.
   */
  async events(): Promise<void> {
    const rows = (await Event.order({ at: "asc", id: "asc" }).pluck(...EVENT_COLUMNS)) as Array<
      Array<string | null>
    >;
    await this.render({
      json: {
        events: rows.map(([at, verb, story, rfc, pr, actor, detail]) => ({
          at: String(at),
          verb,
          story: story ?? null,
          rfc: rfc ?? null,
          pr: pr ?? null,
          actor: actor ?? null,
          detail: detail ?? null,
        })),
      },
    });
  }
}

/** The columns `events.json` carries, in the order `events` destructures them. */
const EVENT_COLUMNS = ["at", "verb", "story_id", "rfc_id", "pr", "actor", "detail"] as const;
