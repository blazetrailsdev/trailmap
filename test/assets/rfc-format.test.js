import { describe, expect, it } from "vitest";
import { relayBody, relayed } from "../../app/assets/javascripts/rfc-format.js";

describe("relayed", () => {
  it("names the story and pane of a story spawn", () => {
    expect(relayed("spawnloop/story-spawn", { story: "a-story", pane: "%7" })).toBe("Spawned a-story in pane %7");
  });

  it("falls back on a story spawn with a null body", () => {
    expect(relayed("spawnloop/story-spawn", null)).toBe("Spawned story in pane ?");
  });

  it("lists a batch's stories", () => {
    expect(relayed("spawnloop/rfc-batch-spawn", { stories: ["a", "b"], pane: "%7" })).toBe(
      "Spawned 2 stories in pane %7: a, b",
    );
    expect(relayed("spawnloop/rfc-batch-spawn", { stories: ["a"], pane: "%7" })).toBe(
      "Spawned 1 story in pane %7: a",
    );
  });

  it("falls back on a batch with a null body", () => {
    expect(relayed("spawnloop/rfc-batch-spawn", null)).toBe("Spawned 0 stories in pane ?: ");
  });

  it("says the same of a refine with JSON and with a null body", () => {
    const text = "Agent spawned — its summary will appear on ringo's Refinements tab when it finishes.";
    expect(relayed("spawnloop/rfc-refine", { ok: true })).toBe(text);
    expect(relayed("spawnloop/rfc-refine", null)).toBe(text);
  });
});

describe("relayBody", () => {
  it("sends the note with a refine or a sunset", () => {
    expect(JSON.parse(relayBody('{"slug":"r","note":"","mode":"sunset"}', "re-home to 0002"))).toEqual({
      slug: "r",
      note: "re-home to 0002",
      mode: "sunset",
    });
  });

  it("leaves a payload that takes no note alone", () => {
    expect(relayBody('{"slug":"r"}', "ignored")).toBe('{"slug":"r"}');
  });
});
