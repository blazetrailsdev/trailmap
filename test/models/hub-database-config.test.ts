import { describe, expect, it } from "vitest";
import { env, setEnv } from "@blazetrails/ruby-compat";
import databases, {
  HUB_MIGRATIONS_PATH,
  hasHubDatabase,
  hubDatabaseConfig,
} from "../../config/database.ts";

/**
 * `config/database.ts`'s hub half — the twin of `tasks-database-config.test.ts`.
 *
 * The three-tier shape matters as much as the values: `trails db` fans out over
 * the entries of the current environment, so a `hub` key that went missing
 * from one of them would stop that environment migrating the hub at all, with
 * no error anywhere.
 */
describe("the database configuration", () => {
  it("names a primary and a hub in every environment", () => {
    const configs = databases as Record<string, Record<string, { adapter?: string }>>;

    expect(Object.keys(configs).sort()).toEqual(["development", "production", "test"]);
    for (const [name, entry] of Object.entries(configs)) {
      expect(Object.keys(entry).sort(), name).toEqual(["hub", "primary"]);
      expect(entry.primary!.adapter, name).toBe("sqlite3");
      expect(entry.hub!.adapter, name).toBe("postgresql");
    }
  });

  it("points the hub's migrations away from the task domain's", () => {
    const configs = databases as Record<string, Record<string, { migrationsPaths?: string }>>;

    // Not `db/migrate`: that is the tasks CLI's shared history, and running it
    // against Postgres is what `--database hub` already does by accident.
    expect(HUB_MIGRATIONS_PATH).toBe("db/hub-migrate");
    expect(configs.development!.hub!.migrationsPaths).toBe(HUB_MIGRATIONS_PATH);
    expect(configs.development!.primary!.migrationsPaths).toBeUndefined();
  });

  it("agrees with hasHubDatabase", () => {
    expect(hasHubDatabase()).toBe(Boolean(env.HUB_DATABASE_URL));
  });

  it("describes the connection HUB_DATABASE_URL names, and refuses when it names none", () => {
    const was = env.HUB_DATABASE_URL;
    try {
      setEnv("HUB_DATABASE_URL", "postgres://u:p@host:5432/hub");
      expect(hubDatabaseConfig()).toEqual({
        adapter: "postgresql",
        url: "postgres://u:p@host:5432/hub",
        migrationsPaths: HUB_MIGRATIONS_PATH,
      });

      // Unset is a throw, not a config with no database in it: a caller that
      // forgot `hasHubDatabase()` fails here rather than somewhere further in.
      setEnv("HUB_DATABASE_URL", undefined);
      expect(hasHubDatabase()).toBe(false);
      expect(() => hubDatabaseConfig()).toThrow(/HUB_DATABASE_URL is not set/);
    } finally {
      setEnv("HUB_DATABASE_URL", was);
    }
  });
});
