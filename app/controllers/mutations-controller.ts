import { Base } from "@blazetrails/activerecord";
import { ApplicationController } from "./application-controller.js";
import { requireLoopback } from "./concerns/loopback-only.js";
import { Story, STORY_STATUSES, type StoryStatus } from "../models/index.js";
import { VerbExit } from "../models/verb-exit.js";

/**
 * The mutation verbs — `claim`, `release`, `in-progress`, `done`,
 * `record-spawn`, `block`, `close`, `status-set`, `priority` — served as JSON
 * on loopback.
 *
 * This controller is where trailmap becomes the SOLE WRITER of `tasks.db`:
 * `config/database.ts` drops `readonly` in the same change, and the CLI stops
 * opening the file to post here instead. The RFC accepts the cost — trailmap
 * being down stops the fleet — and pays for it with a restart policy and the
 * `/up` healthcheck (docs/deploy.md), NOT with a second write path. A
 * fallback that wrote SQLite directly would resurrect the second read model
 * this RFC exists to delete.
 *
 * The actions are thin ON PURPOSE. Every decision — the all-or-nothing claim,
 * the best-effort skip in `markTracking`, `clearedBy`, the `events` row —
 * already lives on the model (app/models/story.ts) and is exercised by
 * test/models/mutations.test.ts. Duplicating any of it here would be a second
 * implementation of exactly the kind this RFC is deleting; the controller's
 * whole job is to parse params, open one transaction, and turn a `VerbExit`
 * into a status code.
 *
 * REFUSALS are the CLI's, verbatim. The message is the model's `VerbExit`
 * message (the text the CLI printed after `error: `), and `exit_code` is the
 * CLI's exit code — 2 benign conflict, 3 lost claim race, 1 real error — so a
 * client wrapping this endpoint can re-exit with the code btwhooks and the
 * agent skills already branch on. The HTTP status is derived from it rather
 * than replacing it: an HTTP-only answer would lose the 2/3 distinction that
 * tells a spawn loop "pick another story" from "you lost the race".
 */
export class MutationsController extends ApplicationController {
  static {
    this.beforeAction(requireLoopback);
  }

  /** `tasks claim <id...> [--assignee NAME]` — assignee defaults to the first id. */
  async claim(): Promise<void> {
    const ids = this.ids();
    if (!ids.length) return this.usage("claim requires at least one story id");
    await this.run(() => Story.claimAll(ids, this.param("assignee") ?? ids[0]));
  }

  /** `tasks release <id...>` */
  async release(): Promise<void> {
    const ids = this.ids();
    if (!ids.length) return this.usage("release requires at least one story id");
    await this.run(() => Story.releaseAll(ids));
  }

  /** `tasks in-progress <id...> --pr N` — the PR is required, as in the CLI. */
  async inProgress(): Promise<void> {
    const ids = this.ids();
    const pr = this.intParam("pr");
    if (!ids.length) return this.usage("in-progress requires at least one story id");
    if (pr === null) return this.usage("in-progress requires --pr");
    await this.run(() => Story.markTrackingAll(ids, "in-progress", pr));
  }

  /** `tasks done <id...> [--pr N]` — the PR is optional here, unlike in-progress. */
  async done(): Promise<void> {
    const ids = this.ids();
    if (!ids.length) return this.usage("done requires at least one story id");
    await this.run(() => Story.markTrackingAll(ids, "done", this.intParam("pr")));
  }

  /**
   * `tasks record-spawn <id...> --source S [--branch B] [--pane P]`, or the
   * RFC-scoped `--rfc R --source S`. Either a story or an RFC identifies the
   * dispatch; a source with neither is the usage refusal the CLI gives.
   */
  async recordSpawn(): Promise<void> {
    const ids = this.ids();
    const source = this.param("source");
    const rfc = this.param("rfc");
    if (!source || (!ids.length && !rfc)) {
      return this.usage("record-spawn requires --source and either story ids or --rfc");
    }
    await this.run(async () => [
      await Story.recordSpawn(ids, source, {
        branch: this.param("branch"),
        pane: this.param("pane"),
        rfc,
      }),
    ]);
  }

  /** `tasks block <id> <reason>` */
  async block(): Promise<void> {
    const reason = this.param("reason");
    if (!reason) return this.usage("block requires a reason");
    await this.onOne((story) => story.block(reason));
  }

  /**
   * `tasks close <id> <reason>`.
   *
   * The empty-reason refusal is the MODEL's (`close requires a reason`), not a
   * usage check here: whitespace-only text passes a `!reason` guard and the
   * model is where that is already decided.
   */
  async close(): Promise<void> {
    const raw = this.params.get("reason");
    if (raw == null) return this.usage("close requires a reason");
    const reason = String(raw);
    await this.onOne((story) => story.close(reason));
  }

  /**
   * `tasks status-set <id> <status>`.
   *
   * An unknown status is refused HERE rather than left to the model: the enum
   * column would take the write and leave a row no read verb can classify.
   *
   * NOT PORTED — the CLI has no such guard (cli.ts case "status-set" casts the
   * raw string to StoryStatus and writes it). This is deliberate hardening for
   * a network-facing endpoint: the CLI's argument came from a human who could
   * read the error, an HTTP body's does not.
   */
  async statusSet(): Promise<void> {
    const status = this.param("status");
    if (!status) return this.usage("status-set requires a status");
    if (!(STORY_STATUSES as readonly string[]).includes(status)) {
      return this.usage(`unknown status "${status}"`);
    }
    await this.onOne((story) => story.statusSet(status as StoryStatus));
  }

  /**
   * `tasks priority <id> <n|clear>`. `"clear"` and an explicit `null` both
   * clear it; a non-numeric value is refused rather than written as `NaN`,
   * which SQLite stores as NULL and so would clear the priority silently.
   *
   * NOT PORTED — the CLI does `Number(raw)` with no finiteness check, so
   * `priority <id> high` silently CLEARS the priority there today. Refusing is
   * deliberate hardening rather than a port, for the same reason as
   * `statusSet` above; reproducing a silent data-loss bug over HTTP is not
   * what criterion 2 is asking for.
   */
  async priority(): Promise<void> {
    const raw = this.params.get("priority");
    let priority: number | null = null;
    if (raw != null && raw !== "clear") {
      priority = Number(raw);
      if (!Number.isFinite(priority)) return this.usage(`priority must be a number or "clear"`);
    }
    await this.onOne((story) => story.setPriority(priority));
  }

  /**
   * The single-story verbs, which the model exposes as INSTANCE methods —
   * loaded through `findAllOrThrow` so a missing id gives the CLI's `story not
   * found:` refusal rather than a null dereference.
   */
  private async onOne(body: (story: Story) => Promise<string>): Promise<void> {
    const ids = this.ids();
    if (ids.length !== 1) return this.usage("this verb takes exactly one story id");
    await this.run(async () => {
      const [story] = await Story.findAllOrThrow(ids);
      return [await body(story)];
    });
  }

  /**
   * One transaction per request, wrapped around whatever the verb does.
   *
   * The class methods (`claimAll`, `releaseAll`, …) already open one of their
   * own; nesting is the point rather than an accident — the outer transaction
   * makes the single-story verbs, which have none, atomic with the `events`
   * row they write, and leaves the batch verbs' own atomicity untouched.
   */
  private async run(body: () => Promise<string[]>): Promise<void> {
    try {
      let lines: string[] = [];
      await Base.transaction(async () => {
        lines = await body();
      });
      this.render({ json: { ok: true, lines } });
    } catch (error) {
      if (!(error instanceof VerbExit)) throw error;
      this.render({
        json: { ok: false, error: error.message, exit_code: error.code },
        status: error.code === 1 ? 422 : 409,
      });
    }
  }

  /**
   * A refusal that never reached the database — the CLI's `usage()` (cli.ts:423).
   *
   * DELIBERATE DEVIATION from "the same refusals the CLI returns, with the
   * same messages". The CLI has no per-verb usage text: every missing-argument
   * case dumps the whole USAGE banner and exits 1. Echoing a banner listing
   * `--flags` into a JSON error field would tell an HTTP caller to fix an
   * argument it never passed, so each case names the thing that is actually
   * missing instead. The exit code stays 1, which is the part callers branch
   * on.
   *
   * The refusals that DO come from the database — not-found, already-claimed,
   * lost-race, close-requires-a-reason — are the CLI's messages verbatim,
   * because those are decided by the model and not restated here.
   */
  private usage(message: string): void {
    this.render({ json: { ok: false, error: message, exit_code: 1 }, status: 400 });
  }

  /**
   * `ids` accepts the JSON array the API is meant to be called with, and a
   * lone string, so `{"ids": "one-story"}` is not silently an empty batch.
   */
  private ids(): string[] {
    const raw = this.params.get("ids");
    if (Array.isArray(raw)) return raw.map((id) => String(id)).filter((id) => id !== "");
    const single = this.param("ids") ?? this.param("id");
    return single === null ? [] : [single];
  }

  private param(name: string): string | null {
    const value = this.params.get(name);
    return value == null || value === "" ? null : String(value);
  }

  /**
   * `null` for absent OR unparseable, the way the CLI's `num()` decides it
   * (cli.ts:106 — `Number.isFinite(Number(v)) ? Number(v) : null`).
   *
   * `Number`, NOT `parseInt`: they disagree on exactly the inputs a typo
   * produces. `parseInt("7abc")` is 7, so `--pr 7abc` would stamp PR 7 on a
   * bundle instead of being refused, and `parseInt("7.9")` truncates where the
   * CLI keeps the value and lets the column reject it. A refusal is the right
   * answer to both, and it is also the answer the CLI already gives.
   *
   * The one deliberate difference: an EMPTY string reads as absent here (see
   * `param`), where the CLI's `Number("")` is 0. `--pr ""` stamping PR 0 is
   * not behaviour worth reproducing.
   */
  private intParam(name: string): number | null {
    const value = this.param(name);
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
