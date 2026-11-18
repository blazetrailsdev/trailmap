import { describe, expect, it } from "vitest";
import { TestCase } from "@blazetrails/activesupport/test-case";
import { withoutFixtures, withoutTransactionalTests } from "./transactional-tests.ts";

type Fixtured = { fixtureTableNames: string[]; fixtureSets: Record<string, string>; useTransactionalTests: boolean };

describe("the transactional-tests opt-outs", () => {
  it("withoutFixtures leaves a case loading no fixtures, and its parent's untouched", () => {
    class Opted extends TestCase {}
    withoutFixtures(Opted);
    expect((Opted as unknown as Fixtured).fixtureTableNames).toEqual([]);
    expect((Opted as unknown as Fixtured).fixtureSets).toEqual({});
    expect((TestCase as unknown as Fixtured).fixtureTableNames).toContain("rfcs");
  });

  it("withoutTransactionalTests turns the transaction off for that case only", () => {
    class Opted extends TestCase {}
    withoutTransactionalTests(Opted);
    expect((Opted as unknown as Fixtured).useTransactionalTests).toBe(false);
    expect((TestCase as unknown as Fixtured).useTransactionalTests).toBe(true);
  });
});
