import { describe, expect, it } from "vitest";
import { env } from "@blazetrails/ruby-compat";
import { writeProtocol } from "../../config/write-protocol.ts";
import { hasTasksDatabase, tasksDatabaseConfig } from "../../config/database.ts";

describe("tasksDatabaseConfig", () => {
  it("agrees with hasTasksDatabase", () => {
    expect(hasTasksDatabase()).toBe(Boolean(env.TASKS_DATABASE));
  });

  it("describes a single-connection pool to the file TASKS_DATABASE names", () => {
    if (!hasTasksDatabase()) {
      // No live database here — the only claim left to make is that asking for
      // one says so, rather than handing back something unusable.
      expect(() => tasksDatabaseConfig()).toThrow(/TASKS_DATABASE is not set/);
      return;
    }
    expect(tasksDatabaseConfig()).toEqual({
      adapter: "sqlite3",
      database: env.TASKS_DATABASE,
      pool: 1,
      // The write protocol (docs/write-protocol.md): the CLI's journal mode
      // and busy timeout, so trailmap waits on its lock instead of failing.
      timeout: writeProtocol.busyTimeoutMs,
      pragmas: { journal_mode: writeProtocol.journalMode },
    });
  });
});
