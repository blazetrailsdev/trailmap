import { Hub } from "./hub.ts";
import { env } from "@blazetrails/ruby-compat";
import { ConnectionNotDefined } from "@blazetrails/activerecord";

/** A setting's value and which source won. */
export interface ResolvedSetting {
  value: string | null;
  source: "database" | "environment" | "unset";
}

/**
 * The settings that are one per application rather than one per repository.
 *
 * Today that is ringo's origin, and only that: `FALLBACKS` is the list, and
 * an entry belongs there when something reads it.
 *
 * Stored key/value, like `app/models/meta.ts` — these are a handful of strings
 * an operator changes, not a schema. A row OVERRIDES the environment variable
 * of the same meaning; the environment is the fallback. That ordering is what
 * makes this safe to deploy: a box that only has `RINGO_BASE` set keeps
 * working unchanged, and a value can then be moved into the table one at a
 * time without a redeploy.
 */
export class Setting extends Hub {
  /**
   * The settings this model knows about, and the env var each one falls back
   * to.
   *
   * ONE entry, and a new one earns its place by being read somewhere. The
   * fleet page's `FLEET_SOCKET_PATH` and `FLEET_CONTROL_PATH` were in here and
   * came out: they are `const`s in `config/fleet.ts` naming routes this
   * application draws itself, not environment variables, so a row would have
   * overridden nothing and the settings page was telling an operator they
   * could be configured. A setting nothing reads is decoration.
   */
  static readonly FALLBACKS: Readonly<Record<string, string>> = {
    ringo_base: "RINGO_BASE",
  };

  /**
   * One setting: the row if there is one, else the environment, else null.
   *
   * An empty or whitespace-only value counts as unset on both sides. A row
   * written blank by a settings form must not shadow a working env var with
   * nothing.
   *
   * With no hub CONNECTION — a process that never ran
   * `config/initializers/hub-database.ts`, which is most of the test suite and
   * every `trails db` command — this reads the environment and nothing else.
   * That is what keeps the fleet surface working, and testable, on a process
   * that has only `RINGO_BASE`: moving a value into the table becomes a
   * per-box decision rather than a new hard dependency for a working page.
   * `findByKey` says why the absent connection is caught rather than predicted.
   *
   * Resolution is memoised briefly; see `resolve`.
   */
  static async lookup(key: keyof typeof Setting.FALLBACKS & string): Promise<string | null> {
    return (await Setting.resolve(key)).value;
  }

  /**
   * Ringo's origin as THIS PROCESS reaches it, e.g. `http://btwhooks.web:8080`
   * on the `fleet` docker network — the row if one is written, else
   * `RINGO_BASE`, trimmed and without its trailing slash either way.
   *
   * THE ONLY RESOLVER. There is one ringo, so there is one function that
   * answers where it is: the four relay paths in
   * `app/controllers/fleet-controller.ts` and the two pages that report
   * whether a relay is configured all call this. A second one — the env
   * reader that used to sit in `config/fleet.ts` — could disagree with this
   * one the moment anything wrote a row, and half the fleet surface would
   * then reach a different origin from the other half.
   *
   * Normalising HERE rather than at each source is the same argument one
   * level down: a row with a trailing slash would otherwise build
   * `http://host//events` where the variable built `http://host/events`.
   *
   * Null when neither names one, which leaves the fleet page with nothing to
   * relay; it says so on the page, it does not guess. Not a URL the browser
   * ever sees — the browser talks only to trailmap (`FLEET_SOCKET_PATH`,
   * `FLEET_CONTROL_PATH`). See `docs/fleet-dashboard.md`.
   */
  static async ringoBase(): Promise<string | null> {
    const base = (await Setting.lookup("ringo_base"))?.replace(/\/+$/, "");
    return base ? base : null;
  }

  /**
   * The stored value of each key, and when it was read from the database.
   *
   * `Setting.ringoBase()` is awaited on every `/fleet/pane/:id/screen` poll
   * and on each of the four relay paths, so going to the row each time meant a
   * Postgres round trip per poll for a string an operator changes by hand.
   *
   * THE ROW IS CACHED, NOT THE RESOLUTION. The environment fallback is re-read
   * every call, which costs nothing and keeps `RINGO_BASE` live — so this is a
   * cache over the query it is meant to remove, and nothing else.
   *
   * TTL rather than forever, because the row can be written by another process
   * or by hand: `write` below clears the entry immediately, and anyone else's
   * change converges within the window instead of needing a restart.
   */
  private static memo = new Map<string, { at: number; stored: string | null }>();
  private static readonly MEMO_MS = 10_000;

  /**
   * A setting's value AND where it came from, in one query.
   *
   * The settings page needs both, and computing "which source won" a second
   * time — re-reading the row, repeating the trim — is how the page and the
   * resolver drift into disagreeing about what is in effect.
   */
  static async resolve(
    key: keyof typeof Setting.FALLBACKS & string,
  ): Promise<ResolvedSetting> {
    const stored = await Setting.storedValue(key);
    if (stored) return { value: stored, source: "database" };

    const fallback = Setting.FALLBACKS[key];
    const fromEnv = fallback ? env[fallback]?.trim() : undefined;
    if (fromEnv) return { value: fromEnv, source: "environment" };

    return { value: null, source: "unset" };
  }

  /** The row's trimmed value, from the memo when it is still fresh. */
  private static async storedValue(key: string): Promise<string | null> {
    const cached = Setting.memo.get(key);
    if (cached && Date.now() - cached.at < Setting.MEMO_MS) return cached.stored;

    const value = (await Setting.findByKey(key))?.value?.trim();
    const stored = value ? value : null;
    Setting.memo.set(key, { at: Date.now(), stored });
    return stored;
  }

  /**
   * The row for `key`, or null — including when nothing is connected.
   *
   * THIS BRANCH EXISTS FOR THE TEST SUITE. Saying so plainly is the honest
   * version: `config/initializers/hub-database.ts` refuses to boot without
   * `HUB_DATABASE_URL` and then reflects the hub's columns, which needs a live
   * connection — so a running server always has a pool and never reaches here.
   * The processes that do are the suite, which drops the boot's pools
   * (test/support/boot.ts), and `trails db`.
   *
   * It is narrow enough to be safe. `ConnectionNotDefined` means ONE thing —
   * no pool was ever established for `Hub`. A wrong URL, a down server or a
   * bad password raise connection errors from the adapter instead, and those
   * propagate from here like any other fault, so this cannot turn a
   * misconfigured database into a quietly wrong page.
   *
   * Two narrower-looking tests were tried and are both WRONG:
   *
   * - `hasHubDatabase()`, i.e. asking whether `HUB_DATABASE_URL` is set. The
   *   variable says what a process COULD connect to; what decides whether
   *   there is a row to read is whether it DID. The suite runs with the
   *   variable set and no pool established, and predicting from the variable
   *   failed 44 tests across four controllers.
   * - `Hub.isConnected()`. A pool answers false until one of its connections
   *   is actually open, so a freshly booted process would fall back to the
   *   environment on its first request and then stop doing so.
   *
   * The alternative is to establish a hub in those suites. It was not taken
   * because the fleet and home pages genuinely do not need one, and requiring
   * Postgres to test them would make them SKIP on a machine without it —
   * trading a branch this comment can explain for coverage that silently
   * disappears.
   */
  private static async findByKey(key: string): Promise<Setting | null> {
    try {
      return (await Setting.findBy({ key })) ?? null;
    } catch (error) {
      if (error instanceof ConnectionNotDefined) return null;
      throw error;
    }
  }

  /**
   * Write one setting.
   *
   * Find-then-create races on the primary key: two writers both miss, both
   * insert, and the loser gets a uniqueness violation out of what reads like
   * an upsert. Rails answers this with `upsert`, which is one statement and
   * lets the database arbitrate.
   */
  static async write(key: string, value: string | null): Promise<void> {
    await Setting.upsert({ key, value }, { uniqueBy: "key" });
    Setting.memo.delete(key);
  }

  /** Drop the memo. For a test that writes rows behind this model's back. */
  static forgetResolved(): void {
    Setting.memo.clear();
  }
}
