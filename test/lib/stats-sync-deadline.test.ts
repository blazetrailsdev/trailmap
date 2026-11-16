import { describe, expect, it } from "vitest";
import { SyncDeadlineExceededError, syncLatest } from "../../lib/stats-sync/sync.ts";

describe("syncLatest", () => {
  it("stops with SyncDeadlineExceededError once its deadline has passed", async () => {
    const error = await syncLatest({ deadlineMinutes: Number.MIN_VALUE }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncDeadlineExceededError);
    expect((error as Error).message).toContain("deadline");
  });
});
