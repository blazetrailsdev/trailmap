import { describe, expect, it } from "vitest";
import { daysSince } from "../../app/models/concerns/elapsed.js";

const NOW = Date.parse("2026-09-06T12:00:00Z");

describe("daysSince", () => {
  it("reads the date-only stamp the CLI writes and the ISO one RFCs carry", () => {
    expect(daysSince("2026-09-01", NOW)).toBe(5);
    expect(daysSince("2026-09-01T00:00:00Z", NOW)).toBe(5);
  });

  it("truncates rather than rounds, matching Go's integer division", () => {
    // 5 days and 12 hours is still 5 days open, not 6.
    expect(daysSince("2026-09-01T00:00:00Z", NOW)).toBe(5);
    expect(daysSince("2026-09-06T00:00:00Z", NOW)).toBe(0);
  });

  it("floors a future stamp at zero rather than reporting a negative age", () => {
    expect(daysSince("2026-12-01", NOW)).toBe(0);
  });

  it("reports nothing for an absent or unparseable stamp", () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince("", NOW)).toBeNull();
    expect(daysSince("someday", NOW)).toBeNull();
  });
});
