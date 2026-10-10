import { describe, expect, it } from "vitest";
import { env, setEnv } from "@blazetrails/ruby-compat";
import { connectToHubDatabase } from "../../config/initializers/hub-database.js";
import { Hub } from "../../app/models/hub.js";
import { Owner } from "../../app/models/owner.js";
import { missingHubTables } from "../../app/models/index.js";

/**
 * The hub initializer, as `tasks-database.test.ts` tests the other one:
 * importing the module already RAN it (that is the whole contract for a
 * `config/initializers` file), so these assert the state the import left and
 * then that calling it again is safe.
 */
describe("connectToHubDatabase", () => {
  it("leaves the connection alone when HUB_DATABASE_URL names nothing under test", async () => {
    if (env.HUB_DATABASE_URL) {
      // The other branch is asserted below; with a URL present there is no
      // "unset" to observe without unsetting it for everything else.
      expect(env.HUB_DATABASE_URL).toBeTruthy();
      return;
    }
    await connectToHubDatabase();

    // Nothing was substituted: asking for the connection is what fails, so a
    // hub model cannot silently read an empty database.
    await expect(Owner.count()).rejects.toThrow();
  });

  it("connects the hub models when it names one", async () => {
    if (!env.HUB_DATABASE_URL) return;
    await connectToHubDatabase();

    expect(Hub.connectionPool().dbConfig.adapter).toBe("postgresql");
    // A query, not just a pool: schema reflection is what `loadHubSchemas`
    // exists for, and an unreflected enum column throws on first use.
    expect(typeof (await Owner.count())).toBe("number");
  });

  /**
   * The deployed `ConnectionNotDefined`, from the boot side — the lesson
   * `config/initializers/tasks-database.ts` records, applied to the second
   * database. A container that comes up without this variable answers dokku's
   * `/up` green (the health check touches no row) and 500s on `/blazetrailsdev`
   * and every page under it.
   */
  it("refuses to boot a served environment with no HUB_DATABASE_URL", async () => {
    const url = env.HUB_DATABASE_URL;
    const nodeEnv = env.NODE_ENV;
    setEnv("HUB_DATABASE_URL", undefined);
    setEnv("NODE_ENV", "production");
    try {
      await expect(connectToHubDatabase()).rejects.toThrow(/HUB_DATABASE_URL is not set/);
    } finally {
      setEnv("HUB_DATABASE_URL", url);
      setEnv("NODE_ENV", nodeEnv);
    }
  });

  /**
   * The OTHER half of the same failure, and the one trailmap#48 actually
   * shipped: a URL that points at a database with no tables. It connects,
   * `loadHubSchemas` reflects without complaint, `/up` reads no row and
   * answers green — and then every page under `/:owner` 500s with
   * `relation "repositories" does not exist`.
   *
   * ON A DATABASE OF ITS OWN, created and dropped here. The first version
   * renamed a table in the SHARED hub and renamed it back, which is a race no
   * lock fixes: vitest runs files in parallel workers, each with its own
   * connection, and `two-adapters` truncated `settings` while this file had it
   * renamed. Nothing about "make a table missing" can be done to a database
   * other tests are using, so this one does not share it.
   */
  it("refuses to boot against a database that has no hub schema", async () => {
    if (!env.HUB_DATABASE_URL) return;
    await connectToHubDatabase();

    expect(await missingHubTables()).toEqual([]);

    // Unique per run, because vitest's workers run at the same time.
    // `toString(36)` keeps it to [0-9a-z]; the prefix keeps it a legal
    // identifier, which may not start with a digit.
    const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
    const scratch = `hub_schema_probe_${suffix}`;
    await Hub.connectionPool().withConnection(async (connection) => {
      await connection.execute(`DROP DATABASE IF EXISTS ${scratch}`);
      await connection.execute(`CREATE DATABASE ${scratch}`);
    });

    const url = String(env.HUB_DATABASE_URL);
    const empty = url.replace(/\/[^/?]+(\?|$)/, `/${scratch}$1`);
    try {
      // The ENVIRONMENT, not just the pool: `connectToHubDatabase` builds its
      // config from `HUB_DATABASE_URL` every time it runs, so pointing only
      // the pool at the scratch database left it reconnecting to the real hub
      // and finding every table.
      setEnv("HUB_DATABASE_URL", empty);
      await Hub.establishConnection({ adapter: "postgresql", url: empty, pool: 1 });

      expect(await missingHubTables()).toEqual([
        "owners",
        "repositories",
        "repository_collaborators",
        "repository_settings",
        "settings",
      ]);

      await expect(connectToHubDatabase()).rejects.toThrow(
        /database without the hub schema/,
      );
    } finally {
      // Back to the real hub, then drop the scratch — in that order, because
      // a database cannot be dropped from a connection that is using it.
      setEnv("HUB_DATABASE_URL", url);
      await Hub.removeConnection();
      await connectToHubDatabase();
      await Hub.connectionPool().withConnection((connection) =>
        connection.execute(`DROP DATABASE IF EXISTS ${scratch}`),
      );
    }

    expect(await missingHubTables()).toEqual([]);
  });

});
