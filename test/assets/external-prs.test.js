import { describe, expect, it } from "vitest";
import { isInboxEvent, prsOf, reviewState } from "../../app/assets/javascripts/external-prs.js";

const pr = { repo: "blazetrailsdev/trails", pr: 7, lastActivityAt: "2026-11-20T10:00:00Z" };

describe("reviewState", () => {
  it("is none with no draft and nothing started", () => {
    expect(reviewState(pr, null, undefined)).toBe("none");
  });

  it("is draft ready when the draft is newer than the PR's last activity", () => {
    expect(reviewState(pr, { draftedAt: "2026-11-20T11:00:00Z" }, undefined)).toBe("draft ready");
  });

  it("is stale when the PR moved after its draft", () => {
    expect(reviewState(pr, { draftedAt: "2026-11-20T09:00:00Z" }, undefined)).toBe("stale");
  });

  it("is drafting from a start until a draft written after it arrives", () => {
    const startedAt = Date.parse("2026-11-20T12:00:00Z");
    expect(reviewState(pr, null, startedAt)).toBe("drafting");
    expect(reviewState(pr, { draftedAt: "2026-11-20T11:00:00Z" }, startedAt)).toBe("drafting");
    expect(reviewState(pr, { draftedAt: "2026-11-20T12:30:00Z" }, startedAt)).toBe("draft ready");
  });
});

describe("prsOf", () => {
  it("keeps only this repo's PRs, in ringo's order", () => {
    const other = { ...pr, repo: "blazetrailsdev/tasks", pr: 8 };
    expect(prsOf([other, pr], "blazetrailsdev/trails")).toEqual([pr]);
    expect(prsOf(null, "blazetrailsdev/trails")).toEqual([]);
  });
});

describe("isInboxEvent", () => {
  it("answers external_pr.* and external_review.* only", () => {
    expect(isInboxEvent({ type: "external_pr.opened" })).toBe(true);
    expect(isInboxEvent({ type: "external_review.drafted" })).toBe(true);
    expect(isInboxEvent({ type: "external_issue.opened" })).toBe(false);
    expect(isInboxEvent(null)).toBe(false);
  });
});
