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

  /** `tasks in-progress <id...> --pr repo#N` — the PR is required, as in the CLI. */
  async inProgress(): Promise<void> {
    const ids = this.ids();
    const pr = this.prParam("pr");
    if (!ids.length) return this.usage("in-progress requires at least one story id");
    if (pr === INVALID_PR) return this.usage(PR_REF_USAGE);
    if (pr === null) return this.usage("in-progress requires --pr");
    await this.run(() => Story.markTrackingAll(ids, "in-progress", pr));
  }

  /** `tasks done <id...> [--pr repo#N]` — the PR is optional here, unlike in-progress. */
  async done(): Promise<void> {
    const ids = this.ids();
    const pr = this.prParam("pr");
    if (!ids.length) return this.usage("done requires at least one story id");
    // Given-but-malformed is refused, not read as "no PR": on `done` that would
    // silently drop the PR.
    if (pr === INVALID_PR) return this.usage(PR_REF_USAGE);
    await this.run(() => Story.markTrackingAll(ids, "done", pr));
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
   *
   * DEDUPED, as every batch verb in the CLI does before dispatching
   * (`[...new Set(pos)]`, cli.ts:322/328/335/343). `findAllOrThrow` resolves
   * `WHERE id IN (...)`, so a repeat was never a double write — but `claimAll`
   * builds its report by mapping the ids it was GIVEN (story.ts), so
   * `["s1","s1"]` answered "claimed s1" twice for one claim. A caller
   * reconciling that count against the queue would be reading a lie.
   */
  private ids(): string[] {
    const raw = this.params.get("ids");
    const list = Array.isArray(raw)
      ? raw.map((id) => String(id)).filter((id) => id !== "")
      : ((single) => (single === null ? [] : [single]))(this.param("ids") ?? this.param("id"));
    return [...new Set(list)];
  }

  private param(name: string): string | null {
    const value = this.params.get(name);
    return value == null || value === "" ? null : String(value);
  }

  /**
   * A `repo#N` PR ref (`trails#7228`, `tasks#94`), the shape the tasks CLI's
   * `--pr` takes since PR numbers from different repos collide. `null` when
   * absent, `INVALID_PR` when given but malformed — a bare `7`, `7abc`,
   * `trails#07` — which the verbs refuse, as the CLI does. An EMPTY string
   * reads as absent (see `param`).
   */
  private prParam(name: string): string | null | typeof INVALID_PR {
    const value = this.param(name);
    if (value === null) return null;
    const m = PR_REF_RE.exec(value.trim());
    return m ? `${m[1]}#${Number(m[2])}` : INVALID_PR;
  }
}

/** Mirrors the tasks CLI's src/pr-ref.ts. */
const PR_REF_RE = /^([a-z0-9][a-z0-9._-]*)#([1-9]\d*)$/;
const PR_REF_USAGE = "--pr takes repo#N, e.g. trails#7228 or tasks#94";
const INVALID_PR = Symbol("invalid pr");
