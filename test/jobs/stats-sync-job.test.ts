import { getFs, getOs, getPath } from "@blazetrails/ruby-compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncLatest = vi.hoisted(() => vi.fn());
vi.mock("../../lib/stats-sync/sync.ts", () => ({ syncLatest, currentStage: () => "Syncing job logs" }));
const packagesMissingCompareData = vi.hoisted(() => vi.fn());
vi.mock("../../lib/stats-sync/missing-compare-data.ts", () => ({ packagesMissingCompareData }));

import { constantize } from "@blazetrails/activesupport";
import { env } from "@blazetrails/ruby-compat";
import { StatsSyncJob } from "../../app/jobs/stats-sync-job.ts";
import { ApplicationMailer } from "../../app/mailers/application-mailer.ts";

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
    packagesMissingCompareData.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    delete writable["EMAIL"];
    delete writable["STATS_SYNC_LOG"];
    delete writable["STATS_SYNC_DB"];
    getFs().rmSync(dir, { recursive: true, force: true });
  });

  it("closes a good run with the ok verdict", async () => {
    await new StatsSyncJob().perform();
    expect(syncLatest).toHaveBeenCalledOnce();
    expect(read()).toMatch(/^=== \S+ ===\n\[cron-wrapper\] ok\n$/);
  });

  it("mails EMAIL the packages a good run left with no compare data", async () => {
    writable["EMAIL"] = "ops@example.com";
    ApplicationMailer.deliveryMethod = "test";
    ApplicationMailer.deliveries.length = 0;
    packagesMissingCompareData.mockResolvedValue([{ package: "rack-test", missing: ["api"] }]);
    await new StatsSyncJob().perform();
    expect(read()).toContain("[cron-wrapper] missing compare data: rack-test (api)\n");
    expect(ApplicationMailer.deliveries).toHaveLength(1);
    const mail = ApplicationMailer.deliveries[0]!;
    expect(String(mail.subject())).toBe("[stats-sync] 1 package has no compare data");
    expect(String(mail.body())).toContain("rack-test: no api rows");
  });

  it("logs a failed missing-data check without failing a good run", async () => {
    packagesMissingCompareData.mockRejectedValue(new Error("no such table: package_meta"));
    await new StatsSyncJob().perform();
    expect(read()).toContain("[cron-wrapper] ok\n[cron-wrapper] missing-data check failed: no such table: package_meta\n");
  });

  it("writes its run header in whole seconds, as the wrapper did", async () => {
    await new StatsSyncJob().perform();
    expect(read()).toMatch(/^=== \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z ===\n/);
  });

  it("names the stage and error in a failed verdict and rethrows", async () => {
    syncLatest.mockRejectedValue(new Error("no such table: x\nstack"));
    const job = new StatsSyncJob() as unknown as { performNow(): Promise<unknown> };
    await expect(job.performNow()).rejects.toThrow("no such table");
    expect(read()).toMatch(
      /\[cron-wrapper\] stats sync failed at stage "Syncing job logs" \(execution 1\): no such table: x\n/,
    );
  });

  it("mails EMAIL the stage, error and log tail when a run fails for good", async () => {
    writable["EMAIL"] = "ops@example.com";
    ApplicationMailer.deliveryMethod = "test";
    ApplicationMailer.deliveries.length = 0;
    syncLatest.mockRejectedValue(new Error("no such table: x\nstack"));
    const job = new StatsSyncJob() as unknown as { performNow(): Promise<unknown> };
    await expect(job.performNow()).rejects.toThrow("no such table");
    expect(ApplicationMailer.deliveries).toHaveLength(1);
    const mail = ApplicationMailer.deliveries[0]!;
    expect([...(mail.to() as string[])]).toEqual(["ops@example.com"]);
    expect(String(mail.subject())).toBe("[trailmap] StatsSyncJob failed: Error: no such table: x");
    expect(String(mail.body())).toContain("Stage: Syncing job logs");
    expect(String(mail.body())).toContain('[cron-wrapper] stats sync failed at stage "Syncing job logs"');
  });

  it("notes an alert it could not send without masking the sync's error", async () => {
    writable["EMAIL"] = "ops@example.com";
    const addDeliveryMethod = ApplicationMailer.addDeliveryMethod as (name: string, klass: unknown) => void;
    addDeliveryMethod.call(ApplicationMailer, "refused", class {
      deliverBang(): never {
        throw new Error("connection refused");
      }
    });
    ApplicationMailer.deliveryMethod = "refused";
    syncLatest.mockRejectedValue(new Error("no such table: x"));
    const job = new StatsSyncJob() as unknown as { performNow(): Promise<unknown> };
    await expect(job.performNow()).rejects.toThrow("no such table");
    expect(read()).toContain("[cron-wrapper] alert email to ops@example.com could not be sent: connection refused\n");
    ApplicationMailer.deliveryMethod = "test";
  });

  it("mails when a rate limit outlives its last retry", async () => {
    writable["EMAIL"] = "ops@example.com";
    ApplicationMailer.deliveryMethod = "test";
    ApplicationMailer.deliveries.length = 0;
    syncLatest.mockRejectedValue(new Error("API rate limit exceeded"));
    const job = new StatsSyncJob() as unknown as {
      performNow(): Promise<unknown>;
      retryJob(options: unknown): Promise<void>;
    };
    vi.spyOn(job, "retryJob").mockResolvedValue();
    await job.performNow();
    expect(ApplicationMailer.deliveries).toHaveLength(0);
    await expect(job.performNow()).rejects.toThrow("API rate limit exceeded");
    expect(read()).toContain('stats sync failed at stage "Syncing job logs" (execution 2)');
    expect(ApplicationMailer.deliveries).toHaveLength(1);
    expect(String(ApplicationMailer.deliveries[0]!.subject())).toBe(
      "[trailmap] StatsSyncJob failed: RateLimitedSync: API rate limit exceeded",
    );
  });

  it("sends no alert while a retry is still due", async () => {
    writable["EMAIL"] = "ops@example.com";
    ApplicationMailer.deliveryMethod = "test";
    ApplicationMailer.deliveries.length = 0;
    syncLatest.mockRejectedValue(new Error("API rate limit exceeded"));
    await expect(new StatsSyncJob().perform()).rejects.toThrow();
    expect(ApplicationMailer.deliveries).toHaveLength(0);
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
