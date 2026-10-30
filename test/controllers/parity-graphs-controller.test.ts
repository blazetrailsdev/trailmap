/**
 * `/graphs/parity` and the JSON behind it, served from the projection.
 *
 * The point of these is the DECOUPLING: the 7 GB stats file fills
 * `parity_days` and is not needed to read it, so every case here runs with no
 * `STATS_DB` at all — the state a production deployment is in — and the page
 * still has to draw. Before the projection, this endpoint read the stats file
 * per request and had nothing to say without it.
 *
 * `scripts/gate-ringo-parity.ts` is what checks the response against ringo's,
 * point for point, over the live database; what is checked here is the
 * behaviour a gate run against a populated database cannot see — the empty
 * projection, the absent stats file, and a refresh that throws.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnv } from "@blazetrails/ruby-compat";
import {
  connectHubTestDatabase,
  HUB_SETUP_TIMEOUT,
  hasHubTestDatabase,
  releaseHubTestDatabase,
  truncateHub,
} from "../support/hub-schema.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";
import { ParityGraphsController } from "../../app/controllers/parity-graphs-controller.ts";
import { ParityDay } from "../../app/models/parity-day.ts";
import * as refresh from "../../app/models/parity-refresh.ts";

/** One projected row. */
function row(attributes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metric: "api",
    package: "arel",
    day: "2026-05-01",
    pr_number: 11,
    matched: 15,
    total: 20,
    percent: 75,
    gaps: { misplaced: 1, missing: 4 },
    ...attributes,
  };
}

/** The `data` action's JSON, for one query string. */
async function data(params: Record<string, string> = {}): Promise<Record<string, any>> {
  const tc = await controllerTestCase(ParityGraphsController);
  await tc.get("data", { params });
  return JSON.parse(String(tc.response.body));
}

describe.skipIf(!hasHubTestDatabase())("ParityGraphsController", () => {
  beforeAll(async () => {
    await connectHubTestDatabase();
    // No stats database anywhere in this file — see the file comment.
    setEnv("STATS_DB", undefined);
  }, HUB_SETUP_TIMEOUT);
  beforeEach(truncateHub);
  afterAll(releaseHubTestDatabase);

  describe("show", () => {
    it("renders with no stats database and an empty projection", async () => {
      const tc = await controllerTestCase(ParityGraphsController);
      await tc.get("show");

      expect(tc.response.status).toBe(200);
      // Which of the two situations it is, rather than "no stats database":
      // there is nothing to chart, and nothing here can fill it.
      expect(String(tc.response.body)).toContain("Nothing projected yet");
      expect(String(tc.response.body)).toContain("pnpm parity:sync");
    });

    it("draws the chart once the projection has rows, stats file or not", async () => {
      await ParityDay.insertAll([row()]);

      const tc = await controllerTestCase(ParityGraphsController);
      await tc.get("show");

      expect(tc.response.status).toBe(200);
      expect(String(tc.response.body)).not.toContain("Nothing projected yet");
    });
  });

  describe("data", () => {
    it("says the projection is empty, and that nothing here can fill it", async () => {
      // The useful half of the message. With a stats database this says to run
      // the sync; without one, saying so would send someone to a command that
      // cannot work on this host.
      expect((await data()).error).toContain("STATS_DB is not set");
    });

    it("serves a series from the projection alone", async () => {
      await ParityDay.insertAll([row(), row({ day: "2026-05-03", pr_number: 12, percent: 90 })]);

      const body = await data({ packages: "arel" });

      expect(body.metrics_selected).toEqual(["api"]);
      expect(body.packages).toEqual(["arel"]);
      // The gap tabs come off a STORED row, in the metric's order — the page
      // draws them in that order and ringo emits them in it.
      expect(body.gaps_by_metric.api).toEqual(["misplaced", "missing"]);
      expect(body.series).toHaveLength(1);
      expect(body.series[0].points.map((p: { percent: number }) => p.percent)).toEqual([75, 90]);
    });

    it("offers the runs the projection holds, not the ones the schema has columns for", async () => {
      await ParityDay.insertAll([row(), row({ metric: "calls", gaps: { mismatched: 0 } })]);

      const body = await data();

      // Two of eight. Those agree with `PARITY_METRICS` after a refresh, and
      // only this is true of a deployment with nothing to reflect against.
      expect(body.metrics.map((m: { key: string }) => m.key)).toEqual(["api", "calls"]);
    });

    it("defaults to the first run the PROJECTION can chart", async () => {
      // `api` is absent, so `PARITY_METRICS[0]` would be selected, chart
      // nothing, and report no error: a blank chart under a populated picker.
      await ParityDay.insertAll([row({ metric: "calls", gaps: { mismatched: 2 } })]);

      const body = await data({ packages: "arel" });

      expect(body.metrics_selected).toEqual(["calls"]);
      expect(body.series).toHaveLength(1);
    });

    it("refuses an unknown metric and drops an unknown package", async () => {
      await ParityDay.insertAll([row()]);

      expect((await data({ metrics: "nope" })).error).toBe("unknown metric nope");

      // A bookmarked URL can name packages from another run; the page says
      // what it ignored rather than failing the request.
      const body = await data({ packages: "arel,gone" });
      expect(body.unknown_packages).toEqual(["gone"]);
      expect(body.series).toHaveLength(1);
    });

    it("refuses more packages than the palette has colours", async () => {
      await ParityDay.insertAll([row()]);
      const nine = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].join(",");

      expect((await data({ packages: nine })).error).toContain("at most 8 packages");
    });

    it("serves the existing projection when the refresh throws", async () => {
      await ParityDay.insertAll([row()]);
      // An unreadable stats file, a constraint violation, a lock error. A
      // refresh is an optimisation on top of data the page already has, so it
      // must not take down a page that can serve it — without the rescue this
      // was a 500 and "render what is there" was true only of the lock case.
      const stub = vi
        .spyOn(refresh, "refreshProjectionIfStale")
        .mockRejectedValue(new Error("stats.db: disk I/O error"));

      try {
        const body = await data({ packages: "arel" });
        expect(body.series).toHaveLength(1);
      } finally {
        stub.mockRestore();
      }
    });
  });
});
