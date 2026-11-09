import { describe, expect, it } from "vitest";
import { DatabaseConfigurations } from "@blazetrails/activerecord";
import { env } from "@blazetrails/ruby-compat";
import databaseConfigurations, { primaryDatabaseConfig } from "../../config/database.ts";
import { writeProtocol } from "../../config/write-protocol.ts";

describe("config/database.ts", () => {
  for (const envName of ["development", "production"]) {
    it(`points ${envName}'s primary at TASKS_DATABASE, one connection, no database tasks`, () => {
      const config = primaryDatabaseConfig(envName);
      expect(config.configurationHash).toMatchObject({
        adapter: "sqlite3",
        database: env.TASKS_DATABASE?.trim() || undefined,
        pool: 1,
        timeout: writeProtocol.busyTimeoutMs,
        pragmas: { journal_mode: writeProtocol.journalMode },
      });
      expect(config.databaseTasks()).toBe(false);
    });

    it(`leaves ${envName}'s primary out of what trails db fans out over`, () => {
      const names = new DatabaseConfigurations(databaseConfigurations)
        .configsFor({ envName })
        .map((config) => config.name);
      expect(names).not.toContain("primary");
      expect(names).toContain("hub");
    });
  }

  it("keeps test's primary a scratch file trails db may build", () => {
    expect(primaryDatabaseConfig("test").databaseTasks()).toBe(true);
  });
});
