import { describe, expect, it } from "vitest";
import { Base } from "@blazetrails/activerecord";
import { env, setEnv } from "@blazetrails/ruby-compat";
import { hasTasksDatabase } from "../../config/database.ts";
import { Trailmap } from "../../config/application.ts";
import { connectToTasksDatabase } from "../../config/initializers/tasks-database.ts";
import { writeProtocol } from "../../config/write-protocol.ts";
import { Story } from "../../app/models/index.ts";

/**
 * Importing the initializer registers `connectToTasksDatabase` as a `server`
 * block, which `trails server` awaits before it binds; these call that block
 * directly, and calling it more than once is safe.
 */
describe("connectToTasksDatabase", () => {
  it("is registered as a server block", () => {
    expect(Trailmap.registeredBlocksFor("server")).toContain(connectToTasksDatabase);
  });

  it("leaves the connection alone when TASKS_DATABASE names nothing under test", async () => {
    if (hasTasksDatabase()) {
      // The other branch is asserted below; with a live database present there
      // is no "unset" to observe without unsetting it for everything else.
      expect(env.TASKS_DATABASE).toBeTruthy();
      return;
    }
    await connectToTasksDatabase();

    // The test environment migrates its own scratch database, so an unset
    // variable is tolerated HERE and nowhere else (see the boot test below).
    // No connection was established, so asking for one is what fails — the
    // initializer did not silently substitute an empty database.
    expect(() => Base.leaseConnection()).toThrow();
  });

  it("connects the models to the live tasks database when it names one", async () => {
    if (!hasTasksDatabase()) return;
    await connectToTasksDatabase();

    const story = await Story.findBy({ id: "serve-the-read-verbs-as-json" });
    expect(story).not.toBeNull();
    expect(story!.rfc_id).toBe("0136-trailmap");
  });

  /**
   * The deployed 500 (`ConnectionNotDefined at /rfcs`), from the boot side.
   *
   * The container ran with no `TASKS_DATABASE`, this initializer returned
   * without establishing anything, and nothing else in the boot path
   * establishes a connection — so the process served a green `/up` and a 500
   * on every page that reads a row. A test that established a connection
   * itself would prove nothing about that; this one runs the boot path with
   * the deployment's environment and asserts it refuses to come up.
   */
  it("refuses to boot a served environment with no TASKS_DATABASE", async () => {
    const database = env.TASKS_DATABASE;
    const nodeEnv = env.NODE_ENV;
    setEnv("TASKS_DATABASE", undefined);
    setEnv("NODE_ENV", "production");
    try {
      await expect(connectToTasksDatabase()).rejects.toThrow(/TASKS_DATABASE is not set/);
    } finally {
      setEnv("TASKS_DATABASE", database);
      setEnv("NODE_ENV", nodeEnv);
    }
  });

  it("opens the live database under the write protocol", async () => {
    if (!hasTasksDatabase()) return;

    // Read-write by decision (docs/deploy.md), so what is asserted is WAL and
    // the shared busy timeout from docs/write-protocol.md, not a refused write.
    // `selectValue` is async, and `String(promise)` typechecks: unawaited,
    // this compared "[object Promise]" and failed wherever it actually ran.
    const connection = await Base.leaseConnection();
    expect(String(await connection.selectValue("PRAGMA journal_mode"))).toBe(
      writeProtocol.journalMode.toLowerCase(),
    );
    expect(Number(await connection.selectValue("PRAGMA busy_timeout"))).toBe(
      writeProtocol.busyTimeoutMs,
    );
  });
});
