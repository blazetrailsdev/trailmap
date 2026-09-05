import { respondTo } from "@blazetrails/actionpack";
import { ApplicationController } from "./application-controller.js";
import { requireLoopback } from "./concerns/loopback-only.js";
import { Story } from "../models/index.js";
import { summarizeBundle } from "../models/concerns/ranking.js";
import { serializeStories } from "../serializers/story-json.js";

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
export class StoriesController extends ApplicationController {
  static {
    this.beforeAction(requireLoopback);
  }

  /** `tasks list [--status S] [--rfc R] [--cluster C]` */
  async index(): Promise<void> {
    const rows = await Story.listFiltered({
      rfc: this.param("rfc"),
      status: this.param("status"),
      cluster: this.param("cluster"),
    });
    await this.renderStories(rows);
  }

  /** `tasks ready [--rfc R]` — the ready queue, in ready-queue order. */
  async ready(): Promise<void> {
    await this.renderStories(await Story.claimable({ rfc: this.param("rfc") }));
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
    const opts = { maxLoc, cluster: this.param("cluster"), rfc: this.param("rfc") };
    const rows = await Story.nextBundle(opts);
    const summary = summarizeBundle(rows, maxLoc);
    const stories = await serializeStories(rows);
    this.respondWith({
      stories,
      bundle_total_loc: summary.total,
      max_loc: maxLoc,
      lead_exceeds_budget: summary.leadExceedsBudget,
      empty_reason: rows.length === 0 ? await Story.emptyBundleReason(opts) : null,
    });
  }

  /** `tasks show <id>` — one story, or 404. */
  async show(): Promise<void> {
    const id = this.param("id") ?? "";
    const story = await Story.findBy({ id });
    if (!story) {
      this.render({ json: { error: `story "${id}" not found` }, status: 404 });
      return;
    }
    await this.renderStories([story]);
  }

  /** `tasks touching <path> [--all]` */
  async touching(): Promise<void> {
    const path = this.param("path") ?? "";
    const rows = await Story.touching(path, { all: this.param("all") !== undefined });
    await this.renderStories(rows);
  }

  /**
   * `show` renders the bare object the CLI's `show` prints; every other verb
   * renders the array its `--json` prints.
   */
  private async renderStories(rows: Story[]): Promise<void> {
    const stories = await serializeStories(rows);
    this.respondWith(this.actionName === "show" ? stories[0] : stories);
  }

  /**
   * The HTML half of these actions does not exist yet — the dashboard pages
   * are a later story — so anything that is not asking for JSON is declined
   * here rather than falling through to a missing template.
   */
  private respondWith(payload: unknown): void {
    // Negotiated on the `Accept` header ALONE, deliberately not through
    // `Base#respondTo`: that consults `request.format`, which answers "html"
    // when a client sends no `Accept` at all — and ringo's Go client sends
    // none. Registering `json` first also makes `*/*` (curl's default) resolve
    // to JSON, so both non-browser callers get JSON without asking for it.
    respondTo(
      (format) => {
        format.json(() => this.render({ json: payload }));
        format.any(() => this.render({ json: { error: "not_acceptable" }, status: 406 }));
      },
      { accept: (this.request.getHeader("accept") as string | undefined) ?? undefined },
    );
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
