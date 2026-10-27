import { ApiController } from "./api-controller.ts";
import { integerParam, presentParam } from "./concerns/api-params.ts";
import { Story } from "../models/index.ts";
import { listFilteredIn, summarizeBundle } from "../models/concerns/ranking.ts";
import { serializeStories, type SerializedStory, type StoryJsonContext } from "../serializers/story-json.ts";

/** `next-bundle`'s default budget, matching the CLI's `--max-loc` default. */
const DEFAULT_MAX_LOC = 250;

/**
 * The read verbs — `ready`, `next-bundle`, `list` (index), `show`, `touching`
 * — served as JSON.
 *
 * One listener, two audiences, per the RFC: the pages answer HTML on the
 * public hostname behind SSO, and the API answers JSON on loopback only. The
 * format is the ROUTE's (`defaults({ format: "json" })` in config/routes.ts),
 * as a Rails API scope fixes it, so every action renders JSON whatever the
 * client's `Accept` says — ringo's Go client sends none.
 *
 * `requireLoopback` (LoopbackOnly) runs first, so a proxied request is a 404:
 * the API must not be reachable from the public hostname, and a 404 (rather
 * than a 403) declines to confirm it exists.
 *
 * Responses are `readmodel.ts`'s shapes verbatim — see story-json.ts. The two
 * consumers being replaced (the CLI's `--json` and webhook/tasksdb.go) parse
 * these today, so the shapes are a contract, not a choice.
 */
export class StoriesController extends ApiController {
  /** `tasks list [--status S] [--rfc R] [--cluster C]` */
  async index(): Promise<void> {
    const index = await Story.rankingRows();
    const rows = listFilteredIn(index, {
      rfc: presentParam(this.params, "rfc"),
      status: presentParam(this.params, "status"),
      cluster: presentParam(this.params, "cluster"),
    });
    await this.renderStories(rows, index);
  }

  /** `tasks ready [--rfc R]` — the ready queue, in ready-queue order. */
  async ready(): Promise<void> {
    const { stories, index } = await Story.readyQueue({ rfc: presentParam(this.params, "rfc") });
    await this.renderStories(stories, index);
  }

  /**
   * `tasks next-bundle [--max-loc N] [--cluster C] [--rfc R]`.
   *
   * The OBJECT shape is a contract with btwhooks, which unmarshals it into
   * `bundleResult` (spawnloop.go). Emitting a bare array made every spawn
   * attempt fail with "cannot unmarshal array into Go value of type
   * webhook.bundleResult" — the loop stayed enabled, tried, and silently never
   * spawned. Keep the CLI's keys exactly.
   */
  async nextBundle(): Promise<void> {
    const maxLoc = integerParam(this.params, "max-loc") ?? DEFAULT_MAX_LOC;
    const { stories: rows, index, emptyReason } = await Story.bundle({
      maxLoc,
      cluster: presentParam(this.params, "cluster"),
      rfc: presentParam(this.params, "rfc"),
    });
    const summary = summarizeBundle(rows, maxLoc);
    const stories = serializeStories(rows, index);
    await this.render({ json: {
      stories,
      bundle_total_loc: summary.total,
      max_loc: maxLoc,
      lead_exceeds_budget: summary.leadExceedsBudget,
      empty_reason: emptyReason,
    } });
  }

  /**
   * `tasks show <id>` — one story, or 404.
   *
   * Found in the snapshot rather than by its own `findBy`, exactly as the CLI
   * does (`index.stories.find`): the story still has to be serialized, and the
   * serialization needs the snapshot anyway.
   */
  async show(): Promise<void> {
    const id = presentParam(this.params, "id") ?? "";
    const index = await Story.rankingIndex();
    const story = index.stories.find((s) => s.id === id);
    if (!story) {
      await this.render({ json: { error: `story "${id}" not found` }, status: 404 });
      return;
    }
    await this.renderStories([story], index);
  }

  /**
   * `tasks touching <path> [--all]`.
   *
   * A missing `path` is refused, matching the CLI's `if (!pos[0]) return
   * usage()`. It cannot be allowed to default to the empty string: the
   * substring tier is `p.includes(query)`, which every path satisfies, so the
   * whole open backlog would come back dressed as a search result.
   */
  async touching(): Promise<void> {
    const path = presentParam(this.params, "path");
    if (path === undefined) {
      await this.render({ json: { error: "touching requires a path" }, status: 400 });
      return;
    }
    const index = await Story.rankingIndex();
    const rows = await Story.touching(path, { index, all: presentParam(this.params, "all") !== undefined });
    await this.renderStories(rows, index);
  }

  /**
   * `show` renders the bare object the CLI's `show` prints; every other verb
   * renders the array its `--json` prints.
   */
  private async renderStories(rows: SerializedStory[], index: StoryJsonContext): Promise<void> {
    const stories = serializeStories(rows, index);
    await this.render({ json: this.actionName === "show" ? stories[0] : stories });
  }
}
