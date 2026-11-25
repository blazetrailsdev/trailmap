/** The preview tag and link on /deploys, as rails/app/helpers/deploys_helper.rb has them. */
import { describe, expect, it } from "vitest";
import { DeploysHelper } from "../../app/helpers/deploys-helper.ts";

const { deployKind, deployPreviewUrl, deployScreenPath, deployDuration } = DeploysHelper;

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
    // As Rails prints it: the host keeps its case, no trailing slash is added.
    expect(deployPreviewUrl({ url: "https://Trailmap-PR-160.deanoftech.com" })).toBe("https://Trailmap-PR-160.deanoftech.com");
    expect(deployPreviewUrl({ url: "javascript:alert(1)" })).toBeNull();
    expect(deployPreviewUrl({ url: "http://trailmap-pr-160.deanoftech.com/" })).toBeNull();
    expect(deployPreviewUrl({ url: "not a url" })).toBeNull();
    expect(deployPreviewUrl({})).toBeNull();
    // Inputs WHATWG URL accepts and Ruby's URI does not.
    expect(deployPreviewUrl({ url: "https:trailmap-pr-160.deanoftech.com" })).toBeNull();
    expect(deployPreviewUrl({ url: " https://trailmap-pr-160.deanoftech.com " })).toBeNull();
    expect(deployPreviewUrl({ url: "https://" })).toBeNull();
    // Ruby's RFC 3986 grammar decides, and its `to_s` is the href.
    expect(deployPreviewUrl({ url: "https://a.com/<x>" })).toBeNull();
    expect(deployPreviewUrl({ url: "https://a.com/%zz" })).toBeNull();
    expect(deployPreviewUrl({ url: "https://a.com/\"" })).toBeNull();
    expect(deployPreviewUrl({ url: "https://a.com\\x" })).toBeNull();
    expect(deployPreviewUrl({ url: "https://h\u00e9st.com" })).toBeNull();
    expect(deployPreviewUrl({ url: "HTTPS://a.com" })).toBe("https://a.com");
    expect(deployPreviewUrl({ url: "https://a.com:99999" })).toBe("https://a.com:99999");
    expect(deployPreviewUrl({ url: "https://a.com:443/" })).toBe("https://a.com/");
    expect(deployPreviewUrl({ url: "https://a.com?q=a b" })).toBe("https://a.com?q=a%20b");
  });
});

describe("deployScreenPath", () => {
  it("names the run alone, encoded", () => {
    expect(deployScreenPath({ id: "a b" })).toBe("/deploys/screen?id=a%20b");
  });
});

describe("deployDuration", () => {
  it("writes seconds, then minutes and seconds, as Rails' deploy_duration does", () => {
    expect(deployDuration(42)).toBe("42s");
    expect(deployDuration(125)).toBe("2m 5s");
  });
});
