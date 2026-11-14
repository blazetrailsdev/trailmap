import { describe, expect, it } from "vitest";
import { STAGES, reviewersByKey, sessionStage } from "../../app/assets/javascripts/fleet-format.js";

const pr = (over = {}) => ({ owner: "o", repo: "r", pr: 7, draft: false, merged: false, ciStatus: "pending", reviewCycles: 0, openFindings: 0, ...over });
const spawn = (over = {}) => ({ story_id: "some-story", branch: "some-story-ab12", ...over });
const assigned = reviewersByKey([{ owner: "o", repo: "r", pr: 7, agent: "codex", pane_id: "%3" }]);
const none = reviewersByKey([]);

describe("sessionStage", () => {
  it("lists the six stages in order", () => {
    expect(STAGES.map(([id]) => id)).toEqual(["drafting", "self", "ringo", "ci", "ready", "merged"]);
  });

  it("row 1: a merged PR is Merged", () => {
    expect(sessionStage(pr({ merged: true }), none)).toBe("merged");
  });

  it("row 1 outranks red CI and a reviewer", () => {
    expect(sessionStage(pr({ merged: true, ciStatus: "failure" }), assigned)).toBe("merged");
  });

  it("row 2: a spawn with no PR is Drafting", () => {
    expect(sessionStage(spawn(), none)).toBe("drafting");
  });

  it("row 2 honors a reported self review", () => {
    expect(sessionStage(spawn(), none, "self")).toBe("self");
  });

  it("row 2 ignores any other reported stage", () => {
    expect(sessionStage(spawn(), none, "merged")).toBe("drafting");
  });

  it("row 3: a PR with a reviewer assigned is Reviewer convergence", () => {
    expect(sessionStage(pr({ draft: true }), assigned)).toBe("ringo");
  });

  it("row 3: a non-draft PR with a reviewer assigned", () => {
    expect(sessionStage(pr({ ciStatus: "success" }), assigned)).toBe("ringo");
  });

  it("row 3: open findings with passing CI", () => {
    expect(sessionStage(pr({ ciStatus: "success", openFindings: 2 }), none)).toBe("ringo");
  });

  it("row 4: a draft PR before review is Self review", () => {
    expect(sessionStage(pr({ draft: true }), none)).toBe("self");
  });

  it("row 4: red CI before review is still Self review", () => {
    expect(sessionStage(pr({ draft: true, ciStatus: "failure" }), none)).toBe("self");
  });

  it("row 5: a non-draft PR with passing CI is Ready to merge", () => {
    expect(sessionStage(pr({ ciStatus: "success", reviewCycles: 2 }), none)).toBe("ready");
  });

  it("row 6: a draft PR whose review finished is Getting CI green", () => {
    expect(sessionStage(pr({ draft: true, reviewCycles: 1, ciStatus: "success" }), none)).toBe("ci");
  });

  it("row 6: a non-draft PR with failing CI", () => {
    expect(sessionStage(pr({ ciStatus: "failure", reviewCycles: 1 }), none)).toBe("ci");
  });

  it("a reported stage never overrides a PR's facts", () => {
    expect(sessionStage(pr({ merged: true }), none, "self")).toBe("merged");
    expect(sessionStage(pr({ ciStatus: "success" }), none, "self")).toBe("ready");
  });

  it("reads an unanswered reviewer poll as no reviewer", () => {
    expect(sessionStage(pr({ draft: true }), null)).toBe("self");
  });
});
