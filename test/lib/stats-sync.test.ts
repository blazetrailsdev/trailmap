import { env, getFs, getOs, getPath } from "@blazetrails/ruby-compat";
import { Base, MigrationContext } from "@blazetrails/activerecord";
import { describe, expect, it } from "vitest";
import { STATS_SYNC_MIGRATIONS_PATH, statsSyncDatabaseConfig } from "../../config/database.ts";

const PULL_REQUEST = JSON.stringify([
  {
    number: 7,
    title: "feat: seven",
    author: { login: "dean" },
    createdAt: "2026-10-01T00:00:00Z",
    mergedAt: "2026-10-02T00:00:00Z",
    closedAt: "2026-10-02T00:00:00Z",
    mergeCommit: { oid: "abc" },
    additions: 1,
    deletions: 2,
    changedFiles: 3,
    labels: [],
    headRefName: "seven",
    baseRefName: "main",
    body: "",
    reviewDecision: "APPROVED",
    isDraft: false,
  },
]);
const FAKE_GH = `#!/bin/sh
case "$*" in
  "pr list"*) echo '${PULL_REQUEST}' ;;
  *) echo '[]' ;;
esac
`;

describe("syncLatest", () => {
  it("creates the schema, runs every stage and records the run", async () => {
    const writable = env as Record<string, string | undefined>;
    const dir = getFs().mkdtempSync!(getPath().join(getOs().tmpdir!(), "stats-sync-"));
    getFs().writeFileSync(getPath().join(dir, "gh"), FAKE_GH);
    getFs().chmodSync!(getPath().join(dir, "gh"), 0o755);
    const path = writable["PATH"];
    writable["PATH"] = `${dir}:${path}`;
    writable["STATS_SYNC_DB"] = getPath().join(dir, "stats.db");

    try {
      const { currentStage, syncLatest } = await import("../../lib/stats-sync/sync.ts");
      const { StatsSyncRecord } = await import("../../app/models/stats-sync/index.ts");
      // Migrations run on Base's connection, as `trails db` points it at each database.
      await Base.establishConnection(statsSyncDatabaseConfig());
      try {
        await new MigrationContext([getPath().resolve(STATS_SYNC_MIGRATIONS_PATH)]).migrate();
      } finally {
        await Base.removeConnection();
      }
      await syncLatest();

      expect(currentStage()).toBe("Database Summary");
      const adapter = await StatsSyncRecord.leaseConnection();
      const rows = (await adapter.selectAll("SELECT COUNT(*) AS n FROM sync_log")).toArray();
      expect(Number((rows[0] as { n: number }).n)).toBe(1);
      const prs = (
        await adapter.selectAll("SELECT number, author, state FROM pull_requests")
      ).toArray();
      expect(prs).toEqual([{ number: 7, author: "dean", state: "merged" }]);
      await StatsSyncRecord.removeConnection();
    } finally {
      writable["PATH"] = path;
      delete writable["STATS_SYNC_DB"];
      getFs().rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
