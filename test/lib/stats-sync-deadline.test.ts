import { env, getFs, getOs, getPath } from "@blazetrails/ruby-compat";
import { Base, MigrationContext } from "@blazetrails/activerecord";
import { describe, expect, it } from "vitest";
import { STATS_SYNC_MIGRATIONS_PATH, statsSyncDatabaseConfig } from "../../config/database.ts";
import { SyncDeadlineExceededError, syncLatest } from "../../lib/stats-sync/sync.ts";

describe("syncLatest", () => {
  it("stops with SyncDeadlineExceededError once its deadline has passed", async () => {
    const error = await syncLatest({ deadlineMinutes: Number.MIN_VALUE }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncDeadlineExceededError);
    expect((error as Error).message).toContain("deadline");
  });

  it("kills a gh call still running at the deadline", async () => {
    const writable = env as Record<string, string | undefined>;
    const dir = getFs().mkdtempSync!(getPath().join(getOs().tmpdir!(), "stats-sync-deadline-"));
    getFs().writeFileSync(getPath().join(dir, "gh"), "#!/bin/sh\nsleep 60\n");
    getFs().chmodSync!(getPath().join(dir, "gh"), 0o755);
    const path = writable["PATH"];
    writable["PATH"] = `${dir}:${path}`;
    writable["STATS_SYNC_DB"] = getPath().join(dir, "stats.db");
    try {
      const { StatsSyncRecord } = await import("../../app/models/stats-sync/stats-sync-record.ts");
      await StatsSyncRecord.establishConnection(statsSyncDatabaseConfig());
      await Base.establishConnection(statsSyncDatabaseConfig());
      try {
        await new MigrationContext([getPath().resolve(STATS_SYNC_MIGRATIONS_PATH)]).migrate();
      } finally {
        await Base.removeConnection();
      }
      const started = Date.now();
      const error = await syncLatest({ deadlineMinutes: 2 / 60 }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SyncDeadlineExceededError);
      expect(Date.now() - started).toBeLessThan(30_000);
      await StatsSyncRecord.removeConnection();
    } finally {
      writable["PATH"] = path;
      delete writable["STATS_SYNC_DB"];
      getFs().rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
