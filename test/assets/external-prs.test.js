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

  it("stays drafting between the click and the server's started event, whatever the draft", () => {
    expect(reviewState(pr, null, Infinity)).toBe("drafting");
    expect(reviewState(pr, { draftedAt: "2026-11-20T12:30:00Z" }, Infinity)).toBe("drafting");
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
  const nwo = "blazetrailsdev/trails";
  const fields = { repo: nwo, pr: 7 };

  it("answers external_pr.* and external_review.* about this repo only", () => {
    expect(isInboxEvent({ type: "external_pr.opened", fields }, nwo)).toBe(true);
    expect(isInboxEvent({ type: "external_review.drafted", fields }, nwo)).toBe(true);
    expect(isInboxEvent({ type: "external_issue.opened", fields }, nwo)).toBe(false);
    expect(isInboxEvent({ type: "external_pr.opened", fields: { repo: "blazetrailsdev/tasks", pr: 7 } }, nwo)).toBe(false);
    expect(isInboxEvent({ type: "external_pr.opened" }, nwo)).toBe(false);
    expect(isInboxEvent(null, nwo)).toBe(false);
  });
});
