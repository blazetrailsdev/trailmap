import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "@blazetrails/ruby-compat";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { MailTestsController } from "../../app/controllers/mail-tests-controller.ts";
import { FailingProbeJob } from "../../app/jobs/failing-probe-job.ts";
import { ApplicationMailer } from "../../app/mailers/application-mailer.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

async function request(
  method: "get" | "post",
  action: string,
  params: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const tc = await controllerTestCase(MailTestsController);
  await tc[method](action, { params });
  return { status: tc.response.status, body: String(tc.response.body) };
}

beforeAll(() => {
  ApplicationController.prependViewPath("app/views");
});

describe("MailTestsController", () => {
  const writable = env as Record<string, string | undefined>;

  beforeEach(() => {
    delete writable["EMAIL"];
    ApplicationMailer.deliveryMethod = "test";
    ApplicationMailer.deliveries.length = 0;
  });

  it("renders both forms and says where failure mail goes", async () => {
    writable["EMAIL"] = "ops@example.com";
    const { status, body } = await request("get", "show");
    expect(status).toBe(200);
    expect(body).toContain('action="/mail-test"');
    expect(body).toContain('action="/mail-test/failing-job"');
    expect(body).toContain("<code>ops@example.com</code>");
    expect(body).not.toContain('id="mailTestOutcome"');
  });

  it("says no one gets failure mail when EMAIL is not set", async () => {
    const { body } = await request("get", "show");
    expect(body).toContain("<code>EMAIL</code> is not set");
  });

  it("sends a test email to the given address and reports it", async () => {
    const { status, body } = await request("post", "deliver", { to: "someone@example.com" });
    expect(status).toBe(200);
    expect(body).toContain("Sent a test email to someone@example.com.");
    expect(ApplicationMailer.deliveries).toHaveLength(1);
    expect([...(ApplicationMailer.deliveries[0]!.to() as string[])]).toEqual(["someone@example.com"]);
    expect(String(ApplicationMailer.deliveries[0]!.subject())).toBe("[trailmap] test email");
  });

  it("refuses a missing address without sending", async () => {
    const { status, body } = await request("post", "deliver", { to: " " });
    expect(status).toBe(422);
    expect(body).toContain("Give an email address to send to.");
    expect(ApplicationMailer.deliveries).toHaveLength(0);
  });

  it("shows the relay's error when delivery fails", async () => {
    const addDeliveryMethod = ApplicationMailer.addDeliveryMethod as (name: string, klass: unknown) => void;
    addDeliveryMethod.call(ApplicationMailer, "refused", class {
      deliverBang(): never {
        throw new Error("connection refused");
      }
    });
    ApplicationMailer.deliveryMethod = "refused";
    try {
      const { status, body } = await request("post", "deliver", { to: "someone@example.com" });
      expect(status).toBe(502);
      expect(body).toContain("could not be sent: connection refused");
    } finally {
      ApplicationMailer.deliveryMethod = "test";
    }
  });

  it("enqueues FailingProbeJob and names where its failure is mailed", async () => {
    writable["EMAIL"] = "ops@example.com";
    const was = FailingProbeJob.queueAdapter;
    FailingProbeJob.setQueueAdapter("test");
    const adapter = FailingProbeJob.queueAdapter as { enqueuedJobs: Array<Record<string, unknown>> };
    try {
      const { status, body } = await request("post", "enqueue");
      expect(status).toBe(200);
      expect(body).toMatch(/Enqueued FailingProbeJob [0-9a-f-]+\. When the worker runs it, its failure is mailed to ops@example\.com\./);
      expect(adapter.enqueuedJobs).toHaveLength(1);
    } finally {
      FailingProbeJob.setQueueAdapter(was);
    }
  });
});
