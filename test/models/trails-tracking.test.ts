import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, getFs, setEnv } from "@blazetrails/ruby-compat";
import { TrailsTracking } from "../../app/models/trails-tracking.ts";

/** trails-status.txt, which the tasks repo's tracking cron writes beside tasks.db. */
describe("TrailsTracking", () => {
  let dir: string;
  let was: string | undefined;

  beforeEach(async () => {
    was = env.TASKS_DATABASE;
    dir = await getFs().mkdtemp!("/tmp/trailmap-tracking-");
    setEnv("TASKS_DATABASE", `${dir}/tasks.db`);
  });

  afterEach(async () => {
    setEnv("TASKS_DATABASE", was);
    await getFs().rm!(dir, { recursive: true, force: true });
  });

  it("reads the status the last tracking run wrote beside tasks.db", async () => {
    await getFs().writeFile!(`${dir}/trails-status.txt`, "pin        6bf0fbd\nbehind     3 commits\n");
    expect(await TrailsTracking.status()).toBe("pin        6bf0fbd\nbehind     3 commits");
  });

  it("is nil before any run has written one", async () => {
    expect(await TrailsTracking.status()).toBeNull();
  });

  it("is nil without a tasks database", async () => {
    setEnv("TASKS_DATABASE", undefined);
    expect(await TrailsTracking.status()).toBeNull();
  });

  it("is failing when trails:status escalated a held pin", () => {
    expect(TrailsTracking.isFailing("pin x\n\nERROR: the trails pin has been held")).toBe(true);
    expect(TrailsTracking.isFailing("pin x\nlast run   bumped")).toBe(false);
  });
});
