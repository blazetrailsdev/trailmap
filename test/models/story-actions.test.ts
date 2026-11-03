import { describe, expect, it } from "vitest";
import { storyActions } from "../../app/models/concerns/story-actions.ts";

describe("storyActions", () => {
  it("offers a draft every move but release", () => {
    expect(storyActions("draft", null)).toEqual({
      ready: true,
      top: true,
      block: true,
      close: true,
      release: false,
      spawn: true,
    });
  });

  it("does not offer top to a story already at priority 0", () => {
    expect(storyActions("ready", 0).top).toBe(false);
    expect(storyActions("ready", 3).top).toBe(true);
  });

  it("offers release only to a claimed story, and block to none already blocked", () => {
    expect(storyActions("claimed", null)).toMatchObject({ release: true, top: false, block: true });
    expect(storyActions("blocked", null)).toMatchObject({ block: false, top: true, close: true });
  });

  it("offers nothing to a finished story", () => {
    for (const status of ["done", "closed"]) {
      expect(storyActions(status, null)).toEqual({
        ready: false,
        top: false,
        block: false,
        close: false,
        release: false,
        spawn: false,
      });
    }
  });
});
