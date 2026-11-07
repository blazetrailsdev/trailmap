import { describe, expect, it } from "vitest";
import { sumRatios } from "../../app/controllers/packages-controller.ts";

describe("sumRatios", () => {
  it("answers null for no rows", () => {
    expect(sumRatios([])).toBeNull();
  });

  it("keeps a single row's own percent", () => {
    expect(sumRatios([{ matched: 5, total: 6, percent: 83.3 }])).toEqual({ matched: 5, total: 6, percent: 83.3 });
  });

  it("sums matched and total and recomputes the percent", () => {
    expect(
      sumRatios([
        { matched: 3, total: 4, percent: 75 },
        { matched: 5, total: 6, percent: 83.3 },
      ]),
    ).toEqual({ matched: 8, total: 10, percent: 80 });
  });
});
