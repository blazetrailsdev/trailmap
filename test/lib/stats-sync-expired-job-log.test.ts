import { describe, expect, it } from "vitest";
import { isExpiredJobLogError } from "../../lib/stats-sync/expired-job-log.ts";

describe("isExpiredJobLogError", () => {
  it("recognizes the 404 gh returns for a log past its retention window", () => {
    expect(
      isExpiredJobLogError(
        "Command failed: gh api --allow-escape-sequences " +
          "repos/blazetrailsdev/trails/actions/jobs/79099858897/logs\ngh: HTTP 404\n",
      ),
    ).toBe(true);
  });

  it("recognizes the 410 gh returns for the oldest logs", () => {
    expect(
      isExpiredJobLogError(
        "Command failed: gh api --allow-escape-sequences " +
          "repos/blazetrailsdev/trails/actions/jobs/77412035438/logs\ngh: Server Error (HTTP 410)\n",
      ),
    ).toBe(true);
  });

  it("does not claim a transient transport failure is expired", () => {
    expect(isExpiredJobLogError("stream error: stream ID 1; CANCEL; received from peer")).toBe(
      false,
    );
    expect(isExpiredJobLogError("gh: HTTP 502 Bad Gateway")).toBe(false);
  });
});
