import { constantize } from "@blazetrails/activesupport";
import { describe, expect, it } from "vitest";
import { StatsSyncRecord } from "../../app/models/stats-sync/stats-sync-record.ts";
import { PrComment } from "../../app/models/stats-sync/pr-comment.ts";

describe("config/initializers/stats-sync-database", () => {
  it("connects the class the autoloader seats, which its subclasses inherit from", () => {
    expect(constantize("StatsSync::StatsSyncRecord")).toBe(StatsSyncRecord);
    expect(constantize("StatsSync::PrComment")).toBe(PrComment);
    expect(Object.getPrototypeOf(PrComment)).toBe(StatsSyncRecord);
    expect(PrComment.connectionSpecificationName).toBe("StatsSyncRecord");
  });
});
