import { env } from "@blazetrails/ruby-compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationJob } from "../../app/jobs/application-job.ts";
import { DeliberateFailure, FailingProbeJob } from "../../app/jobs/failing-probe-job.ts";
import { ApplicationMailer } from "../../app/mailers/application-mailer.ts";

class Flaky extends Error {}

class RetriedJob extends ApplicationJob {
  static {
    this.retryOn(Flaky, { attempts: 2 });
  }

  async perform(): Promise<void> {
    throw new Flaky("still flaky");
  }
}

type Runnable = { performNow(): Promise<unknown>; retryJob(options: unknown): Promise<void> };

describe("ApplicationJob failure mail", () => {
  const writable = env as Record<string, string | undefined>;

  beforeEach(() => {
    writable["EMAIL"] = "ops@example.com";
    ApplicationMailer.deliveryMethod = "test";
    ApplicationMailer.deliveries.length = 0;
  });

  afterEach(() => {
    delete writable["EMAIL"];
    ApplicationMailer.deliveryMethod = "test";
  });

  it("mails EMAIL the job, its arguments and the exception when a job raises unhandled", async () => {
    const job = new FailingProbeJob("from a test") as unknown as Runnable & { jobId: string };
    await expect(job.performNow()).rejects.toThrow(DeliberateFailure);
    expect(ApplicationMailer.deliveries).toHaveLength(1);
    const mail = ApplicationMailer.deliveries[0]!;
    expect([...(mail.to() as string[])]).toEqual(["ops@example.com"]);
    expect(String(mail.subject())).toBe(
      "[trailmap] FailingProbeJob failed: DeliberateFailure: deliberate failure from /mail-test: from a test",
    );
    const body = String(mail.body());
    expect(body).toContain(`Job id:     ${job.jobId}`);
    expect(body).toContain('Arguments:  ["from a test"]');
    expect(body).toContain("Executions: 1");
    expect(body).toContain("Backtrace:\nDeliberateFailure: deliberate failure");
  });

  it("mails once, when retryOn runs out of attempts, and not while a retry is due", async () => {
    const job = new RetriedJob() as unknown as Runnable;
    vi.spyOn(job, "retryJob").mockResolvedValue();
    await job.performNow();
    expect(ApplicationMailer.deliveries).toHaveLength(0);
    await expect(job.performNow()).rejects.toThrow("still flaky");
    expect(ApplicationMailer.deliveries).toHaveLength(1);
    expect(String(ApplicationMailer.deliveries[0]!.body())).toContain("Executions: 2");
  });

  it("sends nothing and still raises when EMAIL is not set", async () => {
    delete writable["EMAIL"];
    await expect((new FailingProbeJob("x") as unknown as Runnable).performNow()).rejects.toThrow(DeliberateFailure);
    expect(ApplicationMailer.deliveries).toHaveLength(0);
  });

  it("raises the job's own error, not the mailer's, when delivery fails", async () => {
    const addDeliveryMethod = ApplicationMailer.addDeliveryMethod as (name: string, klass: unknown) => void;
    addDeliveryMethod.call(ApplicationMailer, "refused", class {
      deliverBang(): never {
        throw new Error("connection refused");
      }
    });
    ApplicationMailer.deliveryMethod = "refused";
    await expect((new FailingProbeJob("x") as unknown as Runnable).performNow()).rejects.toThrow(DeliberateFailure);
  });
});
