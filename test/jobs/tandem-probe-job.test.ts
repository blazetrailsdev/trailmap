import { Base } from "@blazetrails/activejob";
import { getFs } from "@blazetrails/ruby-compat";
import { beforeEach, describe, expect, it } from "vitest";
import { TandemProbeJob } from "../../app/jobs/index.ts";

const fixture = (name: string) =>
  JSON.parse(getFs().readFileSync(`test/fixtures/solid-queue/${name}`, "utf8")) as Record<string, unknown>;

describe("TandemProbeJob", () => {
  beforeEach(() => {
    TandemProbeJob.performed = [];
  });

  it("runs a payload the Rails app serialized", async () => {
    await (Base as unknown as { execute(data: unknown): Promise<unknown> }).execute(
      fixture("rails-enqueued.json"),
    );
    expect(TandemProbeJob.performed).toEqual(["from rails"]);
  });

  it("the committed trails payload is what this app serializes", () => {
    const expected = fixture("trails-enqueued.json");
    const job = new TandemProbeJob("from trails") as unknown as { serialize(): Record<string, unknown> };
    const serialized = job.serialize();
    expect(Object.keys(serialized).sort()).toEqual(Object.keys(expected).sort());
    for (const key of ["job_class", "arguments", "queue_name"]) {
      expect(serialized[key]).toEqual(expected[key]);
    }
  });
});
