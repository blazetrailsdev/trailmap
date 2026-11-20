/** The preview tag and link on /deploys, as rails/app/helpers/deploys_helper.rb has them. */
import { describe, expect, it } from "vitest";
import { DeploysHelper } from "../../app/helpers/deploys-helper.ts";

const { deployKind, deployPreviewUrl } = DeploysHelper;

describe("deployKind", () => {
  it("tags preview runs and nothing else", () => {
    expect(deployKind({ target: "preview" })).toBe("preview");
    expect(deployKind({ target: "preview teardown" })).toBe("preview teardown");
    expect(deployKind({ target: "preview sweep" })).toBe("preview sweep");
    expect(deployKind({ target: "trunk" })).toBeNull();
    expect(deployKind({ target: "previewish" })).toBeNull();
    expect(deployKind({})).toBeNull();
  });
});

describe("deployPreviewUrl", () => {
  it("links only an https URL", () => {
    expect(deployPreviewUrl({ url: "https://trailmap-pr-160.deanoftech.com/" })).toBe("https://trailmap-pr-160.deanoftech.com/");
    // Unchanged, as Rails prints it: no lowercasing, no trailing slash added.
    expect(deployPreviewUrl({ url: "https://Trailmap-PR-160.deanoftech.com" })).toBe("https://Trailmap-PR-160.deanoftech.com");
    expect(deployPreviewUrl({ url: "javascript:alert(1)" })).toBeNull();
    expect(deployPreviewUrl({ url: "http://trailmap-pr-160.deanoftech.com/" })).toBeNull();
    expect(deployPreviewUrl({ url: "not a url" })).toBeNull();
    expect(deployPreviewUrl({})).toBeNull();
  });
});
