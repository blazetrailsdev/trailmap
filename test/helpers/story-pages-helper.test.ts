import { describe, expect, it } from "vitest";
import { StoryPagesHelper } from "../../app/helpers/story-pages-helper.ts";

describe("StoryPagesHelper", () => {
  it("prUrl links a repo#N ref in the org, and declines anything else", () => {
    expect(StoryPagesHelper.prUrl("trails#7651")).toBe("https://github.com/blazetrailsdev/trails/pull/7651");
    expect(StoryPagesHelper.prUrl("7651")).toBeNull();
    expect(StoryPagesHelper.prUrl("trails#")).toBeNull();
  });

  it("prLink is an anchor for a ref and escaped text otherwise", () => {
    expect(String(StoryPagesHelper.prLink("trails#7651"))).toBe(
      '<a target="_blank" rel="noopener" href="https://github.com/blazetrailsdev/trails/pull/7651">trails#7651</a>',
    );
    expect(String(StoryPagesHelper.prLink("<b>7651"))).toBe("&lt;b&gt;7651");
  });
});
