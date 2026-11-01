import { getFs, getOs, getPath } from "@blazetrails/ruby-compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncLatest = vi.hoisted(() => vi.fn());
vi.mock("../../lib/stats-sync/sync.ts", () => ({ syncLatest, currentStage: () => "Syncing job logs" }));

import { constantize } from "@blazetrails/activesupport";
import { env } from "@blazetrails/ruby-compat";
import { StatsSyncJob } from "../../app/jobs/index.ts";

describe("StatsSyncJob", () => {
  let dir: string;
  let log: string;
  const writable = env as Record<string, string | undefined>;
  const read = () => getFs().readFileSync(log, "utf8");

  beforeEach(() => {
    dir = getFs().mkdtempSync!(getPath().join(getOs().tmpdir!(), "stats-sync-job-"));
    log = getPath().join(dir, "sync.log");
    writable["STATS_SYNC_LOG"] = log;
    writable["STATS_SYNC_DB"] = getPath().join(dir, "stats.db");
    syncLatest.mockReset();
  });

  afterEach(() => {
    delete writable["STATS_SYNC_LOG"];
    delete writable["STATS_SYNC_DB"];
    getFs().rmSync(dir, { recursive: true, force: true });
  });

  it("closes a good run with the ok verdict", async () => {
    await new StatsSyncJob().perform();
    expect(syncLatest).toHaveBeenCalledOnce();
    expect(read()).toMatch(/^=== \S+ ===\n\[cron-wrapper\] ok\n$/);
  });

  it("names the stage and error in a failed verdict and rethrows", async () => {
    syncLatest.mockRejectedValue(new Error("no such table: x\nstack"));
    const job = new StatsSyncJob() as unknown as { performNow(): Promise<unknown> };
    await expect(job.performNow()).rejects.toThrow("no such table");
    expect(read()).toMatch(
      /\[cron-wrapper\] stats sync failed at stage "Syncing job logs" \(execution 1\): no such table: x\n/,
    );
  });

  it("raises the retried class for a rate limit", async () => {
    syncLatest.mockRejectedValue(new Error("API rate limit exceeded"));
    await expect(new StatsSyncJob().perform()).rejects.toThrow(
      expect.objectContaining({ constructor: expect.objectContaining({ name: "RateLimitedSync" }) }),
    );
  });

  it("reports a gap wider than 26 hours without the word failed", async () => {
    const previous = new Date(Date.now() - 30 * 3_600_000).toISOString();
    getFs().appendFileSync(log, `=== ${previous} ===\n`);
    await new StatsSyncJob().perform();
    expect(read()).toMatch(/\[cron-wrapper\] stale: previous run was 30h ago/);
    expect(read()).not.toMatch(/fail/);
  });

  it("never runs two syncs at once", () => {
    const job = new StatsSyncJob() as unknown as { concurrencyKey(): string };
    expect(job.concurrencyKey()).toContain("stats_sync");
  });

  it("holds the concurrency lock for 23 hours", () => {
    const klass = StatsSyncJob as unknown as { concurrencyDuration: { toI(): number } };
    expect(klass.concurrencyDuration.toI()).toBe(23 * 3600);
  });

  it("retries a rate limit once, after 120 seconds, without a failed verdict", async () => {
    syncLatest.mockRejectedValue(new Error("API rate limit exceeded"));
    const job = new StatsSyncJob() as unknown as {
      executions: number;
      performNow(): Promise<unknown>;
      retryJob(options: { wait: unknown }): Promise<void>;
    };
    const retryJob = vi.spyOn(job, "retryJob").mockResolvedValue();
    await job.performNow();
    expect(retryJob).toHaveBeenCalledOnce();
    const wait = retryJob.mock.calls[0]![0].wait as number;
    expect(Number(wait)).toBeGreaterThanOrEqual(120);
    expect(read()).toContain("[cron-wrapper] retrying");
    expect(read()).not.toContain("[cron-wrapper] stats sync failed");
  });

  it("is what config/recurring.yml schedules, by a registered name", () => {
    const config = getFs().readFileSync("config/recurring.yml", "utf8");
    expect(config).toContain("class: StatsSyncJob");
    expect(constantize("StatsSyncJob")).toBe(StatsSyncJob);
  });

  it("refuses to run without its database", async () => {
    delete writable["STATS_SYNC_DB"];
    await expect(new StatsSyncJob().perform()).rejects.toThrow("STATS_SYNC_DB must be set");
  });
});
