import { describe, expect, it } from "vitest";
import { env } from "@blazetrails/ruby-compat";
import { hasStatsDatabase, statsDatabaseConfig } from "../../config/database.ts";
import { Trailmap } from "../../config/application.ts";
import { connectToStatsDatabase } from "../../config/initializers/stats-database.ts";
import { writeProtocol } from "../../config/write-protocol.ts";

describe("statsDatabaseConfig", () => {
  it("agrees with hasStatsDatabase", () => {
    expect(hasStatsDatabase()).toBe(Boolean(env.STATS_DB));
  });

  it("describes a read-only single-connection pool on the node-sqlite adapter", () => {
    if (!hasStatsDatabase()) {
      expect(() => statsDatabaseConfig()).toThrow(/STATS_DB is not set/);
      return;
    }
    expect(statsDatabaseConfig()).toEqual({
      // A SECOND SQLite driver in this process: the task domain runs on
      // better-sqlite3 and this on Node's built-in node:sqlite.
      adapter: "node-sqlite",
      database: env.STATS_DB,
      // Enforced by SQLite itself, not by convention — trailmap does not own
      // this schema and must never write it.
      readonly: true,
      pool: 1,
      timeout: writeProtocol.busyTimeoutMs,
    });
  });
});

describe("connectToStatsDatabase", () => {
  it("is registered as a server block", () => {
    expect(Trailmap.registeredBlocksFor("server")).toContain(connectToStatsDatabase);
  });

  it("is a no-op without STATS_DB rather than a boot failure", async () => {
    if (hasStatsDatabase()) return;

    // The one place this initializer differs from tasks-database.ts and
    // hub-database.ts, both of which throw. Those back every page; this backs
    // one, against a multi-gigabyte host file that most deployments do not
    // have. Demanding it would make trailmap undeployable to gain nothing.
    await expect(connectToStatsDatabase()).resolves.toBeUndefined();
  });
});
