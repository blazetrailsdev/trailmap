import { env, getFs, getOs, getPath } from "@blazetrails/ruby-compat";
import { Base, MigrationContext } from "@blazetrails/activerecord";
import { describe, expect, it } from "vitest";
import { STATS_SYNC_MIGRATIONS_PATH, statsSyncDatabaseConfig } from "../../config/database.ts";
import { SyncDeadlineExceededError, syncLatest } from "../../lib/stats-sync/sync.ts";
import { TestCase } from "@blazetrails/activesupport/test-case";
import { withoutTransactionalTests } from "../support/transactional-tests.ts";

// Rails' `self.use_transactional_tests = false`: this file opens, migrates and
// deletes its own stats-sync database, which a test's fixture transaction
// would outlive. vitest isolates each file, so this reaches no other. It
// borrows `Base` to migrate that database, then hands `Base` back the suite's
// `primary` with `establishConnection()`, which fixture setup reads.
withoutTransactionalTests(TestCase);

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
    const { StatsSyncRecord } = await import("../../app/models/stats-sync/stats-sync-record.ts");
    try {
      await StatsSyncRecord.establishConnection(statsSyncDatabaseConfig());
      await Base.establishConnection(statsSyncDatabaseConfig());
      try {
        await new MigrationContext([getPath().resolve(STATS_SYNC_MIGRATIONS_PATH)]).migrate();
      } finally {
        await Base.establishConnection();
      }
      const started = Date.now();
      const error = await syncLatest({ deadlineMinutes: 2 / 60 }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SyncDeadlineExceededError);
      expect(Date.now() - started).toBeLessThan(30_000);
    } finally {
      await StatsSyncRecord.removeConnection();
      writable["PATH"] = path;
      delete writable["STATS_SYNC_DB"];
      getFs().rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
