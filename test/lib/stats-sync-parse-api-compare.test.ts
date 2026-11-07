import { describe, expect, it } from "vitest";
import { parseApiCompareFromLogs } from "../../lib/stats-sync/sync.ts";

describe("parseApiCompareFromLogs", () => {
  it("reads a package whose key has a hyphen", () => {
    const log = [
      "  arel  —  335/442 methods (75.8%)  |  files: 50/80",
      "  et-orbi  —  110/110 methods (100%)  |  files: 5/5  |  inheritance: 1/1 (100%)",
      "  solid-queue  —  667/703 methods (94.9%)  |  files: 55/56",
    ].join("\n");
    const stats = parseApiCompareFromLogs(log);
    expect([...stats.keys()]).toEqual(["arel", "et-orbi", "solid-queue"]);
    expect(stats.get("solid-queue")).toMatchObject({ matched: 667, total: 703, percent: 94.9, missing: 36 });
  });
});
