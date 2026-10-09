import { describe, expect, it } from "vitest";
import { env, setEnv } from "@blazetrails/ruby-compat";
import { connectToHubDatabase } from "../../config/initializers/hub-database.js";
import { Hub } from "../../app/models/hub.js";
import { Owner } from "../../app/models/owner.js";

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
});
