import { describe, expect, it } from "vitest";
import {
  POLL_MS,
  atBottom,
  initialState,
  noticeText,
  screenStep,
  screenUrl,
  shouldPoll,
  statusHtml,
  updatedText,
  worktreeName,
} from "../../app/assets/javascripts/pane-format.js";

/**
 * The live pane page's decisions: what one poll does to the page. `pane.js`
 * around it only fetches and assigns.
 */
const SCREEN = {
  exists: true,
  status: "working",
  cwd: "/srv/worktrees/live-pane-view",
  html: "<span>$ ls</span>",
  lines: 1234,
  hash: "h1",
};
const NOW = 1_000_000;

const shown = () => screenStep(initialState(), { body: SCREEN }, NOW).state;

describe("screenStep", () => {
  it("takes a new screen: its html for the page, and its hash for the next poll", () => {
    const { state, html } = screenStep(initialState(), { body: SCREEN }, NOW);

    expect(html).toBe(SCREEN.html);
    expect(state).toMatchObject({ hash: "h1", status: "working", lines: 1234, updatedAt: NOW });
    expect(state.cwd).toBe(SCREEN.cwd);
  });

  it("leaves the DOM alone when ringo says nothing changed, but takes the status", () => {
    const body = { exists: true, status: "waiting", unchanged: true };

    const { state, html } = screenStep(shown(), { body }, NOW + POLL_MS);

    expect(html).toBeNull();
    expect(state).toMatchObject({ hash: "h1", status: "waiting", cwd: SCREEN.cwd, updatedAt: NOW + POLL_MS });
  });

  it("marks a gone pane exited and keeps the last screen", () => {
    const { state, html } = screenStep(shown(), { body: { exists: false } }, NOW + 1);

    expect(html).toBeNull();
    expect(state.exited).toBe(true);
    expect(state.hash).toBe("h1");
    expect(shouldPoll(state, { paused: false, hidden: false })).toBe(false);
  });

  it("records an unreachable ringo without blanking anything, and keeps polling", () => {
    const { state, html } = screenStep(shown(), { error: "ringo is unreachable: ECONNREFUSED" }, NOW + 1);

    expect(html).toBeNull();
    expect(state).toMatchObject({ hash: "h1", updatedAt: NOW, exited: false });
    expect(state.unreachable).toContain("ECONNREFUSED");
    expect(shouldPoll(state, { paused: false, hidden: false })).toBe(true);
  });

  it("clears the unreachable notice on the next answer", () => {
    const down = screenStep(shown(), { error: "down" }, NOW + 1).state;

    const { state } = screenStep(down, { body: { exists: true, status: "idle", unchanged: true } }, NOW + 2);

    expect(state.unreachable).toBe("");
  });

  it("treats an answer that is not an object as no answer", () => {
    expect(screenStep(shown(), { body: null }, NOW).state.unreachable).not.toBe("");
  });
});

describe("polling", () => {
  it("sends the hash it has, encoded, and none on the first poll", () => {
    expect(screenUrl("/fleet/pane/42/screen", "")).toBe("/fleet/pane/42/screen");
    expect(screenUrl("/fleet/pane/42/screen", "a+b/=")).toBe("/fleet/pane/42/screen?have=a%2Bb%2F%3D");
  });

  it("stops while paused or while the tab is hidden", () => {
    expect(shouldPoll(shown(), { paused: false, hidden: false })).toBe(true);
    expect(shouldPoll(shown(), { paused: true, hidden: false })).toBe(false);
    expect(shouldPoll(shown(), { paused: false, hidden: true })).toBe(false);
  });
});

describe("the header", () => {
  it("names the worktree by the last segment of the pane's directory", () => {
    expect(worktreeName("/srv/worktrees/live-pane-view")).toBe("live-pane-view");
    expect(worktreeName("/srv/worktrees/live-pane-view/")).toBe("live-pane-view");
    expect(worktreeName("")).toBe("");
    expect(worktreeName(undefined)).toBe("");
  });

  it("shows the dashboard's dot for the status, and the word", () => {
    expect(statusHtml(shown())).toContain("var(--green)");
    expect(statusHtml(shown())).toContain("working");
    expect(statusHtml({ ...shown(), status: "limit" })).toContain("◑");
    expect(statusHtml({ ...shown(), status: "" })).toContain("idle");
    expect(statusHtml({ ...shown(), status: "<b>" })).toContain("&lt;b&gt;");
  });

  it("shows no status before the first answer or after the pane has gone", () => {
    expect(statusHtml(initialState())).toBe("");
    expect(statusHtml({ ...shown(), exited: true })).toBe("");
  });

  it("counts from the last answer", () => {
    expect(updatedText(initialState(), NOW)).toBe("connecting…");
    expect(updatedText(shown(), NOW + 5000)).toBe("updated 5s ago");
  });

  it("says what is wrong, the pane's exit before anything else", () => {
    expect(noticeText(shown(), { paused: false })).toBe("");
    expect(noticeText(shown(), { paused: true })).toBe("Paused.");
    expect(noticeText({ ...shown(), unreachable: "timeout" }, { paused: false })).toContain("ringo is unreachable");
    expect(noticeText({ ...shown(), exited: true, unreachable: "x" }, { paused: true })).toContain("showing its last screen");
    // A pane already gone on the first poll has no last screen to speak of.
    expect(noticeText({ ...initialState(), exited: true }, { paused: false })).toBe("This pane has exited.");
  });
});

describe("atBottom", () => {
  it("follows output at the end, and not once the reader has scrolled up", () => {
    expect(atBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
    expect(atBottom({ scrollTop: 890, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
    expect(atBottom({ scrollTop: 400, scrollHeight: 1000, clientHeight: 100 })).toBe(false);
    expect(atBottom({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 })).toBe(true);
  });
});
