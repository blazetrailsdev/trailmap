import { env, getFs, getOs, getPath } from "@blazetrails/ruby-compat";
import { describe, expect, it } from "vitest";

describe("syncLatest", () => {
  it("creates the schema, runs every stage and records the run", async () => {
    const writable = env as Record<string, string | undefined>;
    const dir = getFs().mkdtempSync!(getPath().join(getOs().tmpdir!(), "stats-sync-"));
    getFs().writeFileSync(getPath().join(dir, "gh"), "#!/bin/sh\necho '[]'\n");
    getFs().chmodSync!(getPath().join(dir, "gh"), 0o755);
    const path = writable["PATH"];
    writable["PATH"] = `${dir}:${path}`;
    writable["STATS_SYNC_DB"] = getPath().join(dir, "stats.db");

    try {
      const { currentStage, StatsSyncRecord, syncLatest } =
        await import("../../lib/stats-sync/sync.ts");
      await syncLatest();

      expect(currentStage()).toBe("Database Summary");
      const adapter = await StatsSyncRecord.leaseConnection();
      const rows = (await adapter.selectAll("SELECT COUNT(*) AS n FROM sync_log")).toArray();
      expect(Number((rows[0] as { n: number }).n)).toBe(1);
      await StatsSyncRecord.removeConnection();
    } finally {
      writable["PATH"] = path;
      delete writable["STATS_SYNC_DB"];
      getFs().rmSync(dir, { recursive: true, force: true });
    }
  });
});
