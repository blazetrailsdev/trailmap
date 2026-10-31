import { describe, expect, it } from "vitest";
import { classifyCompareStep } from "../../lib/stats-sync/classify-compare-step.ts";

describe("classifyCompareStep", () => {
  it("separates the three api-compare runs", () => {
    expect(
      classifyCompareStep(
        "pnpm exec tsx scripts/api-compare/extract-ts-api.ts && pnpm exec tsx scripts/api-compare/compare.ts",
      ),
    ).toBe("api_compare");
    expect(classifyCompareStep("pnpm exec tsx scripts/api-compare/compare.ts --privates")).toBe(
      "api_compare_privates",
    );
    expect(classifyCompareStep("pnpm exec tsx scripts/api-compare/compare.ts --calls")).toBe(
      "api_calls",
    );
  });

  // The calls run was `--wide-calls` before the rename. Its logs are still
  // reparsed, and classifying them as api_compare overwrites the public-API
  // step with full-surface numbers.
  it("understands the pre-rename --wide-calls flag", () => {
    expect(classifyCompareStep("pnpm exec tsx scripts/api-compare/compare.ts --wide-calls")).toBe(
      "api_calls",
    );
  });

  it("maps the current and historic test-compare entry points", () => {
    for (const cmd of [
      "pnpm exec tsx scripts/test-compare/compare.ts --gates",
      "pnpm exec tsx scripts/test-compare/test-compare.ts --gates",
      "pnpm exec tsx scripts/test-compare/convention-compare.ts",
      "node scripts/ci/bg-gates.mjs wait test-compare",
    ]) {
      expect(classifyCompareStep(cmd)).toBe("test_compare");
    }
  });

  it("ignores steps the sync does not parse", () => {
    for (const cmd of [
      "pnpm install --frozen-lockfile",
      "pnpm exec tsx scripts/schema-compare/compare.ts",
      "pnpm exec tsx scripts/fixtures-compare/compare.ts --models",
      "pnpm exec tsx scripts/api-compare/lint-call-mismatches.ts",
      "node scripts/ci/bg-gates.mjs wait test-names-manifest test-names",
      "node scripts/ci/bg-gates.mjs wait assertions",
    ]) {
      expect(classifyCompareStep(cmd)).toBeNull();
    }
  });
});
