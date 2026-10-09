import { Hub } from "./hub.js";
import { env } from "@blazetrails/ruby-compat";
import { ConnectionNotDefined } from "@blazetrails/activerecord";

/**
 * The settings that are one per application rather than one per repository:
 * ringo's origin and the two paths the fleet page's browser talks to.
 *
 * Stored key/value, like `app/models/meta.ts` — these are a handful of strings
 * an operator changes, not a schema. A row OVERRIDES the environment variable
 * of the same meaning; the environment is the fallback. That ordering is what
 * makes this safe to deploy: a box that only has `RINGO_BASE` set keeps
 * working unchanged, and a value can then be moved into the table one at a
 * time without a redeploy.
 */
export class Setting extends Hub {
  static _tableName = "settings";
  static _primaryKey = "key";

  declare key: string;
  declare value: string | null;

  /** The settings this model knows about, and the env var each one falls back to. */
  static readonly FALLBACKS: Readonly<Record<string, string>> = {
    ringo_base: "RINGO_BASE",
    fleet_socket_path: "FLEET_SOCKET_PATH",
    fleet_control_path: "FLEET_CONTROL_PATH",
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
   *
   * The absent connection is caught rather than predicted from
   * `HUB_DATABASE_URL`: the variable says what a process COULD connect to, and
   * what decides whether there is a row to read is whether it DID.
   */
  static async lookup(key: keyof typeof Setting.FALLBACKS & string): Promise<string | null> {
    const stored = (await Setting.findByKey(key))?.value?.trim();
    if (stored) return stored;
    const fallback = Setting.FALLBACKS[key];
    const fromEnv = fallback ? env[fallback]?.trim() : undefined;
    return fromEnv ? fromEnv : null;
  }

  /** The row for `key`, or null — including when nothing is connected. */
  private static async findByKey(key: string): Promise<Setting | null> {
    try {
      return (await Setting.findBy({ key })) ?? null;
    } catch (error) {
      if (error instanceof ConnectionNotDefined) return null;
      throw error;
    }
  }

  /** Write one setting. Upserts, because there is exactly one row per key. */
  static async write(key: string, value: string | null): Promise<void> {
    const row = await Setting.findBy({ key });
    if (row) {
      await row.update({ value });
      return;
    }
    await Setting.create({ key, value });
  }
}
