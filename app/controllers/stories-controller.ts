import { MimeType } from "@blazetrails/actionpack";
import { ApiController } from "./api-controller.js";
import { Story } from "../models/index.js";
import { listFilteredIn, summarizeBundle } from "../models/concerns/ranking.js";
import { serializeStories, type SerializedStory, type StoryJsonContext } from "../serializers/story-json.js";

/** `next-bundle`'s default budget, matching the CLI's `--max-loc` default. */
const DEFAULT_MAX_LOC = 250;

/**
 * The read verbs — `ready`, `next-bundle`, `list` (index), `show`, `touching`
 * — served as JSON.
 *
 * One listener, two audiences, per the RFC: the dashboard answers HTML on the
 * public hostname behind SSO, and the API answers JSON on loopback only. The
 * split is `respondTo` plus `requireLoopback`, not a second server — so when
 * the HTML halves of these actions land they share this controller, this
 * query, and this ordering rather than reimplementing them.
 *
 * `requireLoopback` runs BEFORE the negotiation, so a proxied request is a 404
 * whatever it asked for: the API must not be reachable from the public
 * hostname, and a 404 (rather than a 403) declines to confirm it exists.
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
      rfc: this.param("rfc"),
      status: this.param("status"),
      cluster: this.param("cluster"),
    });
    await this.renderStories(rows, index);
  }

  /** `tasks ready [--rfc R]` — the ready queue, in ready-queue order. */
  async ready(): Promise<void> {
    const { stories, index } = await Story.readyQueue({ rfc: this.param("rfc") });
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
    const maxLoc = this.intParam("max-loc") ?? DEFAULT_MAX_LOC;
    const { stories: rows, index, emptyReason } = await Story.bundle({
      maxLoc,
      cluster: this.param("cluster"),
      rfc: this.param("rfc"),
    });
    const summary = summarizeBundle(rows, maxLoc);
    const stories = serializeStories(rows, index);
    await this.respondWith({
      stories,
      bundle_total_loc: summary.total,
      max_loc: maxLoc,
      lead_exceeds_budget: summary.leadExceedsBudget,
      empty_reason: emptyReason,
    });
  }

  /**
   * `tasks show <id>` — one story, or 404.
   *
   * Found in the snapshot rather than by its own `findBy`, exactly as the CLI
   * does (`index.stories.find`): the story still has to be serialized, and the
   * serialization needs the snapshot anyway.
   */
  async show(): Promise<void> {
    const id = this.param("id") ?? "";
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
    const path = this.param("path");
    if (path === undefined) {
      await this.render({ json: { error: "touching requires a path" }, status: 400 });
      return;
    }
    const index = await Story.rankingIndex();
    const rows = await Story.touching(path, { index, all: this.param("all") !== undefined });
    await this.renderStories(rows, index);
  }

  /**
   * `show` renders the bare object the CLI's `show` prints; every other verb
   * renders the array its `--json` prints.
   */
  private async renderStories(rows: SerializedStory[], index: StoryJsonContext): Promise<void> {
    const stories = serializeStories(rows, index);
    await this.respondWith(this.actionName === "show" ? stories[0] : stories);
  }

  /**
   * The HTML half of these actions does not exist yet — the dashboard pages
   * are a later story — so anything that is not asking for JSON is declined
   * here rather than falling through to a missing template.
   */
  private async respondWith(payload: unknown): Promise<void> {
    // Rails' `negotiate_mime` (`mime_negotiation.rb:143-153`) over the one
    // type on offer, with the client's types read from the `Accept` header
    // ALONE through `Mime::Type.parse` rather than from `request.formats`.
    // `formats` answers "html" when a client sends no `Accept` at all, and
    // ringo's Go client sends none, so `Base#respondTo` would refuse it. A
    // missing header is treated as `*/*`. As in Rails, `*/*` (curl's default)
    // takes the first type on offer, so `text/html, */*` gets JSON too, and a
    // q-value orders the types without removing one.
    const json = MimeType.lookup("application/json");
    const accept = String(this.request.getHeader("HTTP_ACCEPT") ?? "").trim();
    const accepted = accept === "" ? [MimeType.ALL] : MimeType.parse(accept);
    if (accepted.some((type) => type.string === "*/*" || json.equals(type))) {
      await this.render({ json: payload });
    } else {
      await this.render({ json: { error: "not_acceptable" }, status: 406 });
    }
  }

  private param(name: string): string | undefined {
    const value = this.params.get(name);
    return value == null || value === "" ? undefined : String(value);
  }

  private intParam(name: string): number | undefined {
    const value = this.param(name);
    if (value === undefined) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
}
