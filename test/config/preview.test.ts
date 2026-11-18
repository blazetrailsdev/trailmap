import { afterEach, describe, expect, it } from "vitest";
import { setX } from "../support/config-x.ts";
import { previewPr } from "../../config/preview.ts";
import { ApplicationHelper } from "../../app/helpers/application-helper.ts";

afterEach(() => setX("preview", "pr", undefined));

describe("previewPr", () => {
  it("is null outside a preview, so production shows no banner", () => {
    expect(previewPr()).toBeNull();
    expect(ApplicationHelper.previewPr()).toBeNull();
  });

  it("reads the PR number TRAILMAP_PREVIEW carries", () => {
    setX("preview", "pr", " 160 ");
    expect(previewPr()).toBe(160);
    expect(ApplicationHelper.previewPr()).toBe(160);
  });

  it("refuses a value that is not a PR number, rather than linking to it", () => {
    for (const bad of ["", "  ", "1; rm", "pr-160", "-3", "1.5"]) {
      setX("preview", "pr", bad);
      expect(previewPr()).toBeNull();
    }
  });
});
