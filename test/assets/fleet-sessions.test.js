import { describe, expect, it } from "vitest";
import { controlOutcome, controlRequest, esc, ICONS, isGrooming, repoSections, reviewersByKey } from "../../app/assets/javascripts/fleet-format.js";
import {
  canAskReady,
  canMerge,
  READY_ASK,
  STALL_MS,
  STORIES_MAX_REFS,
  askFor,
  askRow,
  askStrip,
  branchStory,
  fixerAnchor,
  fixerNote,
  frameEvents,
  frameRows,
  idleFor,
  joinFixers,
  logEntries,
  logHtml,
  mergedLine,
  orderSessions,
  agentNote,
  prRef,
  reportedStage,
  reviewLines,
  reviewNote,
  reviewTurn,
  sessionCard,
  sessionDetail,
  suggestHtml,
  terminalHtml,
  terminalPanes,
  sessionGroups,
  sessionKey,
  sessionList,
  sessionStall,
  sessionStories,
  stageOf,
  stallStrip,
  storiesQuery,
  trackPanes,
  unmatchedAsks,
} from "../../app/assets/javascripts/fleet-sessions.js";

/**
 * The session list (RFC 0232): one row per agent session, and what used to
 * live in panels -- a question, the CI fixer, a stall -- inside its row.
 * `now` is injected everywhere, so nothing races the clock.
 */
const NOW = Date.parse("2026-11-14T12:00:00Z");
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();

const PR = { owner: "blazetrailsdev", repo: "trails", pr: 9958, title: "feat: interceptors", branch: "preview-interceptors-1f2e", pane: "%214", paneStatus: "working" };
const SPAWN = { story_id: "move-tracker-state", title: "Move tracker state", branch: "move-tracker-state-7712", at: minutesAgo(6), source: "loop", pane: "%251", pane_status: "working" };
const STORIES = {
  "trails#9958": [
    { id: "interceptor-string-arm", title: "String arm", status: "in-progress", rfc: "0188-mailer", stage: null },
    { id: "preview-interceptors", title: "Preview interceptors", status: "in-progress", rfc: "0188-mailer", stage: null },
  ],
};

const context = (over = {}) => ({
  now: NOW, fixers: [], reviewers: null, queue: [], stories: {}, asks: [], panes: new Map(), open: new Set(), log: new Map(), steps: new Map(), since: "", ...over,
});
/** A pane idle since `minutes` ago, as `trackPanes` would have recorded it. */
const idleSince = (pane, minutes, status = "idle") => new Map([[pane, { status, since: NOW - minutes * 60_000 }]]);

describe("sessionKey / prRef", () => {
  it("keys a PR by its repo and number and a spawn by its branch, safe as an id", () => {
    expect(sessionKey(PR)).toBe("s-pr-blazetrailsdev-trails-9958");
    expect(sessionKey(SPAWN)).toBe("s-spawn-move-tracker-state-7712");
    expect(sessionKey({ ...SPAWN, branch: "a b<c>" })).toBe("s-spawn-a-b-c-");
  });

  it("names a PR as the tasks database does, without its owner", () => {
    expect(prRef(PR)).toBe("trails#9958");
  });
});

describe("storiesQuery", () => {
  it("asks for every PR and every spawn's story, as [] keys", () => {
    expect(storiesQuery([PR, { ...PR, pr: 1, merged: true }], [SPAWN, { kind: "rfc-refine", story_id: "0136-trailmap" }])).toBe(
      "pr[]=trails%239958&pr[]=trails%231&story[]=move-tracker-state",
    );
  });

  it("never asks for more refs than the server takes", () => {
    const prs = Array.from({ length: 150 }, (_, i) => ({ ...PR, pr: i + 1 }));

    expect(storiesQuery(prs, []).split("&")).toHaveLength(STORIES_MAX_REFS);
  });

  it("is empty with nothing to ask about", () => {
    expect(storiesQuery([], [])).toBe("");
  });
});

describe("the lead story", () => {
  it("is the story whose id is the branch without its spawn suffix", () => {
    expect(branchStory("preview-interceptors-1f2e")).toBe("preview-interceptors");
    expect(branchStory("preview-interceptors")).toBe("preview-interceptors");
    const { lead, rest } = sessionStories(PR, STORIES);
    expect(lead.id).toBe("preview-interceptors");
    expect(rest.map((s) => s.id)).toEqual(["interceptor-string-arm"]);
  });

  it("is the first by id when the branch names none of them", () => {
    expect(sessionStories({ ...PR, branch: "unrelated" }, STORIES).lead.id).toBe("interceptor-string-arm");
  });

  it("is nothing until a story is attributed, and the card titles itself with the PR", () => {
    expect(sessionStories(PR, {})).toEqual({ lead: null, rest: [] });
    expect(sessionCard(PR, context())).toContain(">feat: interceptors</a>");
    expect(sessionCard(SPAWN, context({ stories: { "move-tracker-state": [{ id: "move-tracker-state", title: "Move tracker state" }] } }))).toContain('<a class="story lead" href="/story/move-tracker-state"');
  });

  it("titles an open PR's row with the PR's own title, and names its lead story in the note", () => {
    const html = sessionCard(PR, context({ stories: STORIES }));
    expect(html).toContain('<a class="story lead" href="https://github.com/blazetrailsdev/trails/pull/9958" target="_blank">feat: interceptors</a>');
    expect(html).toContain('<a class="story" href="/story/preview-interceptors"');
  });

  it("counts a bundle's stories on the row, and lists the others as links once it is expanded", () => {
    const shut = sessionCard(PR, context({ stories: STORIES }));
    const open = sessionCard(PR, context({ stories: STORIES, open: new Set([sessionKey(PR)]) }));

    expect(shut).toContain(" &middot; 2 stories</div>");
    expect(shut).not.toContain('class="stories"');
    expect(open).toContain('<div class="stories"><a class="story" href="/story/interceptor-string-arm"');
    expect(open).not.toContain("2 stories</div>");
  });
});

describe("the reported stage", () => {
  const reported = { "move-tracker-state": [{ id: "move-tracker-state", title: "t", status: "in-progress", rfc: "r", stage: "self" }] };

  it("makes a spawn whose story reports self Self review", () => {
    expect(reportedStage(SPAWN, reported)).toBe("self");
    expect(stageOf(SPAWN, context({ stories: reported }))).toBe("self");
    expect(stageOf(SPAWN, context())).toBe("drafting");
  });

  it("never outranks a PR's own facts: a merged PR whose story still says self is Merged", () => {
    const merged = { ...PR, merged: true };
    const stories = { "trails#9958": [{ id: "preview-interceptors", stage: "self" }] };

    expect(reportedStage(merged, stories)).toBeNull();
    expect(stageOf(merged, context({ stories }))).toBe("merged");
  });
});

describe("questions in the row", () => {
  // Markup, and a quote that would close the attribute it is written into.
  const hostile = "<img src=x onerror=alert(1)>" + 'x" onclick="alert(1)';
  const second = { question: "Second?", options: [{ label: "Yes" }] };
  const ask = {
    id: hostile, label: hostile, pane: hostile, at: minutesAgo(3),
    questions: [{ header: hostile, question: hostile, options: [{ label: hostile, description: hostile }] }, second],
  };

  it("escapes every piece of model-authored text, in text and in attributes", () => {
    const html = askStrip(ask, NOW);

    expect(html).not.toContain("<img");
    expect(html).not.toContain('" onclick="');
    // Thirteen places: the strip's label, the asker's label and pane, the
    // header, the question, the option's label and its description (its
    // title), the id on both buttons and on the free answer's box, and the
    // answer's question and label.
    expect(html.split(esc(hostile)).length - 1).toBe(13);
  });

  it("renders the flag, each question's options and a free answer, sending answer-ask", () => {
    const html = askStrip({ id: "a1", label: "worker", pane: "%9", at: minutesAgo(3), questions: [second] }, NOW);

    expect(html).toContain('<span class="flag">Waiting on you</span>');
    expect(html).toContain('data-action="answer-ask" data-id="a1" data-answer="Yes"');
    expect(html).toContain('data-action="answer-ask" data-id="a1" data-free="1"');
    expect(html).toContain("3m ago");
  });

  it("goes in the row whose worker pane asked it", () => {
    const question = { id: "q", label: "w", pane: "%214", at: minutesAgo(1), questions: [second] };

    expect(askFor(PR, [question])).toBe(question);
    expect(askFor({ ...PR, pane: "%1" }, [question])).toBeNull();
    expect(sessionCard(PR, context({ asks: [question] }))).toContain("Waiting on you");
  });

  it("gets a row of its own at the top of the list when no session matches its pane", () => {
    const lost = { id: "q", label: "w", pane: "%999", at: minutesAgo(1), questions: [second] };
    const list = sessionList(repoSections([PR], []), context({ asks: [lost] }));

    expect(unmatchedAsks([lost], [PR])).toEqual([lost]);
    expect(list.html.startsWith('<article class="session session-drafting orphan-ask">')).toBe(true);
    expect(askRow(lost, NOW)).toContain("Waiting on you");
    expect(list.html.match(/Waiting on you/g)).toHaveLength(1);
  });

  it("renders each question in exactly one place", () => {
    const mine = { id: "q", label: "w", pane: "%214", at: minutesAgo(1), questions: [second] };
    const list = sessionList(repoSections([PR], []), context({ asks: [mine] }));

    expect(list.html.match(/Waiting on you/g)).toHaveLength(1);
    expect(list.html).not.toContain("orphan-ask");
  });

  it("keeps its strip out of the row's click target, so answering never expands the row", () => {
    const html = sessionCard(PR, context({ asks: [{ id: "q", pane: "%214", at: minutesAgo(1), questions: [second] }] }));

    expect(html.indexOf('class="strip ask"')).toBeGreaterThan(html.indexOf("</div></article>") > 0 ? html.indexOf('data-ui="row"') : 0);
    const row = html.slice(html.indexOf('data-ui="row"'), html.indexOf('class="strip ask"'));
    expect(row).not.toContain("answer-ask");
  });
});

describe("trackPanes / idleFor", () => {
  it("keeps when a pane's status last changed, and restarts the clock on a change", () => {
    const first = trackPanes(null, [{ ...PR, paneStatus: "idle" }], [], NOW - 60_000);
    const same = trackPanes(first, [{ ...PR, paneStatus: "idle" }], [], NOW);
    const changed = trackPanes(same, [{ ...PR, paneStatus: "working" }], [], NOW);

    expect(same.get("%214").since).toBe(NOW - 60_000);
    expect(changed.get("%214")).toEqual({ status: "working", since: NOW });
  });

  it("forgets a pane gone from the frame", () => {
    expect(trackPanes(idleSince("%1", 5), [PR], [], NOW).has("%1")).toBe(false);
  });

  it("counts idle only while the pane is not working, waiting, failing or out of quota", () => {
    const idle = { ...PR, paneStatus: "idle" };

    expect(idleFor(idle, idleSince("%214", 20), NOW)).toBe(20 * 60_000);
    for (const status of ["working", "waiting", "error", "limit"]) {
      expect(idleFor({ ...PR, paneStatus: status }, idleSince("%214", 20, status), NOW)).toBe(0);
    }
    expect(idleFor({ ...idle, pane: "" }, idleSince("%214", 20), NOW)).toBe(0);
  });
});

describe("sessionStall", () => {
  const idle = (row, minutes = 20) => context({ panes: idleSince(row.pane, minutes), now: NOW });
  const assigned = (row) => reviewersByKey([{ owner: row.owner, repo: row.repo, pr: row.pr, agent: "codex" }]);

  const SELF = { ...PR, draft: true, paneStatus: "idle" };
  const RINGO = { ...PR, paneStatus: "idle", reviewCycles: 1 };
  const CI_RED = { ...PR, paneStatus: "idle", ciStatus: "failure", reviewCycles: 1 };
  const DRAFT_GREEN = { ...PR, paneStatus: "idle", ciStatus: "success", draft: true, reviewCycles: 1 };

  it("asks a self-reviewing agent to request review, while no reviewer is assigned", () => {
    expect(sessionStall(SELF, idle(SELF)).message).toBe("Request review?");
    // With a reviewer assigned it is Reviewer convergence, and nothing has come back to converge.
    expect(sessionStall(SELF, { ...idle(SELF), reviewers: assigned(SELF) })).toBeNull();
  });

  it("does not move a review on before a round has come back, or while one is owed", () => {
    const owed = reviewersByKey([{ owner: PR.owner, repo: PR.repo, pr: PR.pr, agent: "codex", review_owed: true }]);

    expect(sessionStall({ ...RINGO, reviewCycles: 0 }, { ...idle(RINGO), reviewers: assigned(RINGO) })).toBeNull();
    expect(sessionStall(RINGO, { ...idle(RINGO), reviewers: owed })).toBeNull();
  });

  it("moves a converged review on to CI, and not one with findings open", () => {
    const ctx = { ...idle(RINGO), reviewers: assigned(RINGO) };

    expect(sessionStall(RINGO, ctx).message).toBe("Move on to CI?");
    expect(sessionStall({ ...RINGO, openFindings: 2 }, ctx)).toBeNull();
  });

  it("asks for the failing check to be fixed", () => {
    expect(sessionStall(CI_RED, idle(CI_RED)).message).toBe("Fix the failing check?");
    expect(sessionStall({ ...CI_RED, ciStatus: "pending" }, idle(CI_RED))).toBeNull();
  });

  it("asks for a green, converged draft to be marked ready, and not one already ready", () => {
    expect(sessionStall(DRAFT_GREEN, idle(DRAFT_GREEN)).message).toBe("Mark it ready?");
    expect(sessionStall({ ...DRAFT_GREEN, draft: false }, idle(DRAFT_GREEN))).toBeNull();
  });

  it("fires only past the threshold", () => {
    expect(sessionStall(CI_RED, idle(CI_RED, STALL_MS / 60_000 - 1))).toBeNull();
    expect(sessionStall(CI_RED, idle(CI_RED, STALL_MS / 60_000))).not.toBeNull();
  });

  it("is never a session with an open question, nor a merged one", () => {
    const asks = [{ id: "q", pane: "%214", questions: [] }];

    expect(sessionStall(CI_RED, { ...idle(CI_RED), asks })).toBeNull();
    expect(sessionStall({ ...CI_RED, merged: true }, idle(CI_RED))).toBeNull();
  });

  it("draws the idle time, the evidence and one button that messages the agent", () => {
    const html = stallStrip(DRAFT_GREEN, sessionStall(DRAFT_GREEN, idle(DRAFT_GREEN, 22)));

    expect(html).toContain("Stalled · idle 22m");
    expect(html).toContain('<span class="met">CI green</span>');
    expect(html).toContain("<span>PR still a draft</span>");
    expect(html).toContain('data-action="pane-send" data-pane="%214"');
    expect(html).toContain('data-text="Mark it ready?"');
    expect(html).toContain('aria-label="Message the agent: Mark it ready?"');
  });
});

describe("the review loop", () => {
  it("is the working side's turn, else the reviewer's while a review is owed, else the agent's", () => {
    expect(reviewTurn("working", { pane_status: "working" })).toBe("agent");
    expect(reviewTurn("idle", { pane_status: "working" })).toBe("reviewer");
    expect(reviewTurn("idle", { pane_status: "idle", review_owed: true })).toBe("reviewer");
    expect(reviewTurn("idle", { pane_status: "idle" })).toBe("agent");
    expect(reviewTurn("idle", null)).toBe("agent");
  });

  it("bolds the side whose turn it is", () => {
    const owed = reviewNote({ ...PR, paneStatus: "idle", reviewCycles: 2 }, { review_owed: true, pane_id: "%9" });
    const working = reviewNote({ ...PR, paneStatus: "working", reviewCycles: 2 }, null);

    expect(owed).toContain('<span class="review-side turn">Reviewer %9 owes review</span>');
    expect(owed).toContain('<span class="review-side">Agent waiting</span>');
    expect(working).toContain('<span class="review-side turn">Agent fixing</span>');
  });

  it("carries the round, and one tooltip with the round and both sides", () => {
    const html = reviewNote({ ...PR, paneStatus: "idle", reviewCycles: 3, lastAction: "pushed <fix>" }, { pane_status: "working" });

    expect(html).toContain('title="Review round 3. Agent: pushed &lt;fix&gt;. Reviewer: reviewing."');
    expect(html).toContain('<span class="review-round">Round 3</span>');
  });

  it("writes each line for its column: who acts and a short verb", () => {
    const at = (paneStatus, reviewCycles, entry) => reviewLines({ ...PR, paneStatus, reviewCycles, lastAction: "Claude review #1 (6 comments)" }, entry);

    expect(at("working", 0, null)).toEqual({ agent: "working", reviewer: "none" });
    expect(at("working", 2, { pane_id: "%9", pane_status: "idle" })).toEqual({ agent: "fixing", reviewer: "%9 waiting" });
    expect(at("idle", 1, { pane_id: "%9", pane_status: "working" })).toEqual({ agent: "waiting", reviewer: "%9 reviewing" });
    expect(at("idle", 1, { pane_id: "%9", review_owed: true })).toEqual({ agent: "waiting", reviewer: "%9 owes review" });
    expect(at("idle", 1, { review_owed: true })).toEqual({ agent: "waiting", reviewer: "no pane" });
    expect(at("idle", 1, { pane_id: "%9" })).toEqual({ agent: "idle", reviewer: "%9 waiting" });
  });

  it("keeps ringo's last action in the tooltip, not the line", () => {
    const html = reviewNote({ ...PR, paneStatus: "idle", reviewCycles: 1, lastAction: "Claude review #1 (6 comments)" }, { pane_id: "%9", pane_status: "working" });

    expect(html).toContain('title="Review round 1. Agent: Claude review #1 (6 comments). Reviewer: reviewing."');
    expect(html).toContain('<span class="review-side">Agent waiting</span>');
    expect(html).toContain('<span class="review-side turn">Reviewer %9 reviewing</span>');
  });

  it("sits under the stage label at Reviewer convergence and nowhere else", () => {
    const reviewers = reviewersByKey([{ owner: PR.owner, repo: PR.repo, pr: PR.pr, agent: "codex" }]);

    expect(sessionCard(PR, context({ reviewers }))).toContain('class="review-note"');
    expect(sessionCard({ ...PR, ciStatus: "success" }, context())).not.toContain('class="review-note"');
    expect(sessionCard({ ...PR, merged: true, reviewCycles: 2 }, context({ reviewers }))).not.toContain('class="review-note"');
  });
});

describe("the CI fixer as a session", () => {
  const fixer = { owner: "blazetrailsdev", repo: "trails", consecutive_red: 2, checks: ["test", "<b>lint</b>"], red_sha: "9f31ca77b1e2", red_url: "https://ci/run/1" };

  it("joins its worker's PR row by PR, or its spawn by story", () => {
    const byPr = joinFixers([{ ...fixer, pr: 9958 }], [PR], []);
    const byStory = joinFixers([{ ...fixer, story_id: "move-tracker-state" }], [], [SPAWN]);

    expect([...byPr.byKey.keys()]).toEqual([sessionKey(PR)]);
    expect([...byStory.byKey.keys()]).toEqual([sessionKey(SPAWN)]);
    expect(byPr.orphans).toEqual([]);
  });

  it("is a Drafting row with no PR when it has neither yet", () => {
    const { orphans } = joinFixers([fixer], [], []);

    expect(orphans).toHaveLength(1);
    expect(orphans[0].repo).toBe("blazetrailsdev/trails");
    const html = sessionCard(orphans[0], context(), fixer);
    expect(html).toContain("no PR yet");
    expect(html).toContain("session-drafting fixer");
  });

  it("is labelled, and sorts first in its repo whatever its stage", () => {
    const ready = { ...PR, pr: 1, ciStatus: "success" };
    const fixed = { ...PR, ciStatus: "failure" };
    const { byKey } = joinFixers([{ ...fixer, pr: 9958 }], [ready, fixed], []);
    const html = sessionCard(fixed, context(), byKey.get(sessionKey(fixed)));

    expect(orderSessions([SPAWN, ready, fixed], context(), byKey)[0]).toBe(fixed);
    expect(html).toContain('<span class="flag kind">CI fixer</span><span class="flag bad">main is red</span>');
    expect(html).toContain('data-fixer="' + fixerAnchor("blazetrailsdev/trails") + '"');
  });

  it("notes its phase, the red checks escaped, the red commit and the respawn lever", () => {
    const note = fixerNote(fixer);

    expect(note).toContain('<span class="fixer-phase red">red</span>');
    expect(note).toContain("2&times; consecutive red");
    expect(note).toContain("&lt;b&gt;lint&lt;/b&gt;");
    expect(note).toContain('<a href="https://ci/run/1" target="_blank"><code>9f31ca77</code></a>');
    expect(note).toContain('data-action="respawn-fixer" data-owner="blazetrailsdev" data-repo="trails"');
    expect(note).toContain(">spawn fixer</button>");
    expect(fixerNote({ ...fixer, story_id: "fix" })).toContain(">respawn fixer</button>");
    expect(fixerNote({ owner: "o", repo: "r", consecutive_red: 1 })).not.toContain("data-action");
  });
});

describe("the session log", () => {
  it("records nothing on a cold load: the log starts when the page did", () => {
    expect(frameEvents(null, [PR], context())).toEqual([]);
  });

  it("records a PR opening, a review, CI turning, a merge and every stage change", () => {
    const ctx = context();
    const before = frameRows([SPAWN, { ...PR, draft: true, ciStatus: "pending" }], ctx);
    const after = [{ ...PR, draft: true, reviewCycles: 1, ciStatus: "failure" }, { ...PR, pr: 2 }];
    const texts = frameEvents(before, after, ctx).map((e) => e.text);

    expect(texts).toEqual(["reviewed, round 1", "CI failed", "stage: Getting CI green", "PR #2 opened"]);
    const merged = frameEvents(frameRows([PR], ctx), [{ ...PR, merged: true }], ctx).map((e) => e.text);
    expect(merged).toEqual(["merged", "stage: Merged"]);
  });

  it("puts events, sent messages and transcript steps in time order", () => {
    const entries = logEntries(
      [{ at: "2026-11-14T11:05:00Z", text: "CI failed" }, { at: "2026-11-14T11:01:00Z", kind: "you", text: "go" }],
      [{ i: 0, at: "2026-11-14T11:00:00Z", kind: "user", text: "do it" }, { i: 1, at: "2026-11-14T11:02:00Z", kind: "tool", tool: "Read", text: "x.ts" }],
    );

    expect(entries.map((e) => e.text)).toEqual(["do it", "go", "Read x.ts", "CI failed"]);
  });

  it("says since when, offers earlier steps and links older archives", () => {
    const ctx = context({ since: "2026-11-14T10:00:00Z" });
    ctx.steps.set(sessionKey(PR), { archives: 3, steps: [{ i: 200, at: "2026-11-14T11:00:00Z", kind: "text", text: "<hi>" }] });
    const html = logHtml(PR, ctx);

    expect(html).toContain("events since");
    expect(html).toContain('data-ui="log-earlier" data-key="' + sessionKey(PR) + '" data-before="200"');
    expect(html).toContain('href="/sessions/blazetrailsdev/trails/9958">2 earlier archives</a>');
    expect(html).toContain("&lt;hi&gt;");
  });

  it("offers no earlier steps once the first is loaded, and says when nothing is recorded", () => {
    const ctx = context();
    ctx.steps.set(sessionKey(PR), { archives: 1, steps: [{ i: 0, at: "2026-11-14T11:00:00Z", kind: "text", text: "a" }] });

    expect(logHtml(PR, ctx)).not.toContain("log-earlier");
    expect(logHtml(SPAWN, context())).toContain("Nothing recorded yet.");
  });
});

describe("sessionCard", () => {
  it("links the PR, shows the stage by its label, and the note and its age", () => {
    const html = sessionCard({ ...PR, lastAction: "pushed <fix>", lastTime: minutesAgo(6) }, context());

    expect(html).toContain('<a class="pr-link" href="https://github.com/blazetrailsdev/trails/pull/9958" target="_blank">trails#9958</a>');
    expect(html).toContain('<span class="Label stage st-ci">');
    expect(html).toContain("Getting CI green</span>");
    expect(html).toContain('<span class="ricon" title="Open pull request">');
    expect(html).toContain('class="session session-ci"');
    expect(html).toContain("pushed &lt;fix&gt;");
    expect(html).toContain(">6m ago</button>");
  });

  it("leads a session with no pull request by the open issue mark, never a pull request one", () => {
    const html = sessionCard(SPAWN, context());
    const draft = sessionCard({ ...PR, draft: true }, context());

    expect(html).toContain('<span class="ricon" title="Open story, no pull request yet">' + ICONS.issue);
    expect(html).not.toContain(ICONS.draft);
    expect(draft).toContain('<span class="ricon draft" title="Draft pull request">' + ICONS.draft);
  });

  it("marks a failed check beside the title, ahead of the PR link", () => {
    const html = sessionCard({ ...PR, ciStatus: "failure" }, context());

    expect(html).toContain("check failed</span>");
    expect(html.indexOf("check failed")).toBeLessThan(html.indexOf("pr-link"));
    expect(html).toContain('class="ci ci-failure"');
    expect(sessionCard({ ...PR, ciStatus: "pending" }, context())).not.toContain("check failed");
  });

  it("offers Merge on any open, non-draft pull request with CI green, whatever its stage", () => {
    const reviewers = reviewersByKey([{ owner: PR.owner, repo: PR.repo, pr: PR.pr, agent: "codex" }]);
    const ready = sessionCard({ ...PR, ciStatus: "success" }, context());
    const inReview = sessionCard({ ...PR, ciStatus: "success", openFindings: 1 }, context({ reviewers }));

    expect(ready).toContain('class="btn btn-sm btn-primary" data-action="merge" data-owner="blazetrailsdev" data-repo="trails" data-pr="9958"');
    expect(inReview).toContain('class="session session-ringo"');
    expect(inReview).toContain('data-action="merge"');
    expect(inReview).toContain('<span class="figure">1 open finding</span>');
    expect(sessionCard({ ...PR, ciStatus: "failure" }, context())).not.toContain('data-action="merge"');
    expect(sessionCard({ ...PR, ciStatus: "pending" }, context())).not.toContain('data-action="merge"');
    expect(sessionCard({ ...PR, ciStatus: "success", draft: true }, context())).not.toContain('data-action="merge"');
    expect(sessionCard({ ...PR, ciStatus: "success", merged: true }, context())).not.toContain('data-action="merge"');
    expect(canMerge(SPAWN)).toBe(false);
    expect(canMerge({ ...PR, ciStatus: "success", mergeConflict: true })).toBe(false);
  });

  it("offers Are we ready? once CI is green, a review round has passed and both sides are idle", () => {
    const waiting = { ...PR, ciStatus: "success", draft: true, reviewCycles: 1, paneStatus: "idle" };
    const html = sessionCard(waiting, context());

    expect(html).toContain('data-action="pane-send" data-pane="%214" data-key="' + sessionKey(waiting) + '" data-text="Are we ready?"');
    expect(html).toContain('id="ready-note-' + sessionKey(waiting) + '"');
    expect(html).not.toContain('data-action="merge"');
    expect(canAskReady(waiting, { pane_id: "%9" })).toBe(true);
    expect(canAskReady(waiting, { pane_id: "%9", pane_status: "working" })).toBe(false);
    expect(canAskReady(waiting, { pane_id: "%9", review_owed: true })).toBe(false);
    expect(canAskReady({ ...waiting, paneStatus: "working" }, null)).toBe(false);
    expect(canAskReady({ ...waiting, paneStatus: "waiting" }, null)).toBe(false);
    expect(canAskReady({ ...waiting, paneStatus: "" }, null)).toBe(true);
    expect(canAskReady({ ...waiting, reviewCycles: 0 }, null)).toBe(false);
    expect(canAskReady({ ...waiting, ciStatus: "pending" }, null)).toBe(false);
    expect(canAskReady({ ...waiting, pane: "" }, null)).toBe(false);
    expect(canAskReady({ ...waiting, draft: false }, null)).toBe(false);
    expect(canAskReady({ ...waiting, merged: true }, null)).toBe(false);
  });

  it("offers Merge but not the question once the PR is out of draft", () => {
    const html = sessionCard({ ...PR, ciStatus: "success", reviewCycles: 1, paneStatus: "idle" }, context());

    expect(html).toContain('data-action="merge"');
    expect(html).not.toContain(READY_ASK + "</button>");
  });

  it("says a spawn has no PR yet, links its story, and offers dismiss once it has failed", () => {
    const html = sessionCard(SPAWN, context());
    const failed = sessionCard({ ...SPAWN, status: "failed", error: "worktree exists", pane_status: "waiting" }, context());

    expect(html).toContain("no PR yet");
    expect(html).toContain('href="/story/move-tracker-state"');
    expect(html).toContain("spawned via loop");
    expect(html).not.toContain("data-action");
    expect(failed).toContain('data-action="dismiss" data-branch="move-tracker-state-7712"');
    expect(failed).toContain("worktree exists");
    // The pane is gone, so its last status is stale and must not be reported.
    expect(failed).not.toContain("waiting for answer");
  });

  it("says when a pane has reached its limit or waits for an answer", () => {
    expect(sessionCard({ ...PR, paneStatus: "limit" }, context())).toContain("limit reached");
    expect(sessionCard({ ...SPAWN, pane_status: "waiting" }, context())).toContain("waiting for answer");
  });

  it("escapes a PR title and a label rather than rendering them", () => {
    const html = sessionCard({ ...PR, title: "<img onerror=x>", labels: ["<b>"] }, context());

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
  });

  it("hands a grooming agent to the RFC row", () => {
    const html = sessionCard({ ...SPAWN, kind: "rfc-refine", story_id: "0136-trailmap" }, context());

    expect(html).toContain('href="/rfc/0136-trailmap"');
    expect(html).not.toContain("no PR yet");
  });

  it("expands by its button, with aria-expanded and the detail it controls", () => {
    const shut = sessionCard(PR, context());
    const open = sessionCard(PR, context({ open: new Set([sessionKey(PR)]) }));

    expect(shut).toContain('aria-expanded="false" aria-controls="' + sessionKey(PR) + '-detail"');
    expect(shut).not.toContain('class="detail"');
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('<div class="detail" id="' + sessionKey(PR) + '-detail">');
  });
});

describe("the expanded card", () => {
  const reviewers = reviewersByKey([{ owner: PR.owner, repo: PR.repo, pr: PR.pr, agent: "claude", pane_id: "%215", pane_status: "idle" }]);
  const open = (row, over = {}) => sessionCard(row, context({ open: new Set([sessionKey(row)]), ...over }));

  it("carries the worker and reviewer panes, which the collapsed card does not", () => {
    const html = open(PR, { reviewers });

    expect(html).toContain('href="/panes/214"');
    expect(html).toContain('href="/panes/215"');
    expect(html.indexOf("/panes/214")).toBeLessThan(html.indexOf("/panes/215"));
    expect(sessionCard(PR, context({ reviewers }))).not.toContain("/panes/214");
  });

  it("carries cleanup and queued notifications", () => {
    const teardown = { ...PR, teardownAt: new Date(NOW + 45_000).toISOString() };
    const queue = [{ Owner: PR.owner, Repo: PR.repo, PR: PR.pr, Message: "CI failed on it" }];
    const html = open(teardown, { queue });

    expect(html).toContain("closing in 45s");
    expect(html).toContain('data-action="cancel-cleanup" data-pane="%214"');
    expect(html).toContain('data-action="send-one" data-pr="9958"');
    expect(sessionCard(teardown, context({ queue }))).not.toContain("cancel-cleanup");
  });

  it("shows the RFC, branch, PR, review, CI and an Open pane link", () => {
    const html = open({ ...PR, ciStatus: "pending", reviewCycles: 2, openFindings: 1, draft: true }, { stories: STORIES });

    expect(html).toContain('<dt>RFC</dt><dd><a href="/rfc/0188-mailer">0188-mailer</a></dd>');
    expect(html).toContain("<dt>Branch</dt><dd><code>preview-interceptors-1f2e</code></dd>");
    expect(html).toContain("#9958</a> draft");
    expect(html).toContain("2 cycles &middot; 1 open finding");
    expect(html).toContain("<dt>CI</dt><dd>CI running</dd>");
    expect(html).toContain('<a class="btn btn-sm" href="/panes/214">Open pane <svg');
  });

  it("has a message box for a live session, posting to its pane", () => {
    const html = open(PR);

    expect(html).toContain('<textarea class="ctl" rows="2" id="compose-' + sessionKey(PR) + '"');
    expect(html).toContain('data-action="pane-send" data-pane="%214" data-key="' + sessionKey(PR) + '" data-source="compose-' + sessionKey(PR) + '"');
  });

  it("has none for a merged session or one with no pane", () => {
    expect(open({ ...PR, merged: true })).not.toContain("composer");
    expect(open({ ...PR, pane: "" })).not.toContain("composer");
  });
});

describe("the list", () => {
  const ctx = context();

  it("sorts the CI fixer above a PR with a higher number", () => {
    const fixed = { ...PR, pr: 5, ciStatus: "failure" };
    const newer = { ...PR, pr: 9000 };
    const byKey = new Map([[sessionKey(fixed), { owner: "blazetrailsdev", repo: "trails" }]]);

    expect(orderSessions([newer, SPAWN, fixed], ctx, byKey)).toEqual([fixed, SPAWN, newer]);
  });

  it("orders a repo's sessions with no PR first, then PRs newest first by number, whatever the stage, grooming last", () => {
    const ci = { ...PR, pr: 1 };
    const ready = { ...PR, pr: 2, ciStatus: "success" };
    const ci2 = { ...PR, pr: 3 };
    const groom = { kind: "rfc-refine", story_id: "r" };

    expect(orderSessions([groom, ready, ci, SPAWN, ci2], ctx).map((s) => s.pr ?? s.story_id)).toEqual([
      "move-tracker-state", 3, 2, 1, "r",
    ]);
  });

  it("counts only RFC refine and sunset spawns as grooming", () => {
    expect([{ kind: "rfc-refine" }, { kind: "rfc-sunset" }, { kind: "manual" }, {}].map(isGrooming)).toEqual([true, true, false, false]);
  });

  it("names the agent's side from its pane status, and nothing without a pane", () => {
    expect(agentNote(SPAWN)).toBe('<span class="review-note"><span class="review-side turn">Agent working</span></span>');
    expect(agentNote({ ...SPAWN, pane_status: "limit" })).toContain("Agent limit");
    expect(agentNote({ ...PR, paneStatus: "" })).toContain('<span class="review-side">Agent idle</span>');
    expect(agentNote({ ...SPAWN, pane: "" })).toBe("");
  });

  it("ranks a /prompt-agent spawn with the loop's, above the PRs, and draws it as a worker", () => {
    const manual = { kind: "manual", title: "Fix the flaky test", branch: "fix-flaky-test-9b2d", at: minutesAgo(2), source: "prompt-agent", pane: "%300", pane_status: "idle" };
    const ci = { ...PR, pr: 1 };

    expect(orderSessions([ci, manual], ctx)).toEqual([manual, ci]);
    expect(sessionCard(manual, ctx)).not.toContain("grooming");
    expect(sessionCard(manual, ctx)).toContain("Fix the flaky test");
  });

  it("says whether the agent is working or idle while drafting and in self review", () => {
    expect(sessionCard(SPAWN, ctx)).toContain('<span class="review-side turn">Agent working</span>');
    expect(sessionCard({ ...SPAWN, pane_status: "idle" }, ctx)).toContain('<span class="review-side">Agent idle</span>');
    expect(sessionCard({ ...PR, draft: true, paneStatus: "" }, ctx)).toContain("Agent idle");
    expect(sessionCard({ ...SPAWN, pane: "" }, ctx)).not.toContain("review-side");
  });

  it("folds merged sessions into one Merged line at the end of their repo, and drops it when there are none", () => {
    const merged = [{ ...PR, merged: true, lastTime: minutesAgo(30) }, { ...PR, pr: 9811, merged: true }];
    const line = mergedLine(merged, context({ stories: STORIES }));
    const list = sessionList(repoSections([PR, ...merged], []), ctx);

    expect(line).toContain("<b>Merged · 2</b>");
    expect(line).toContain("trails#9811");
    expect(line).toContain('href="/story/preview-interceptors"');
    expect(line).toContain("30m ago");
    expect(list.html.indexOf("merged-line")).toBeGreaterThan(list.html.indexOf(sessionKey(PR)));
    expect(mergedLine([], ctx)).toBe("");
  });

  it("opens a merged session's card under the line when it is expanded", () => {
    const merged = { ...PR, merged: true };

    expect(mergedLine([merged], context({ open: new Set([sessionKey(merged)]) }))).toContain('class="detail"');
  });

  it("heads each repo with its count of active sessions", () => {
    const list = sessionList(repoSections([PR, { ...PR, pr: 1, merged: true }], [SPAWN]), ctx);

    expect(list.html).toContain('<h2>blazetrailsdev/trails</h2><span class="Counter">2</span><span class="sr-only"> active</span>');
  });

  it("puts a fixer with no session of its own first in its repo", () => {
    const list = sessionList(repoSections([PR], []), context({ fixers: [{ owner: "blazetrailsdev", repo: "trails", consecutive_red: 1 }] }));

    expect(list.html.indexOf("session-drafting fixer")).toBeLessThan(list.html.indexOf(sessionKey(PR)));
  });

  it("puts a repo's own extras, the clear-failed button, beside its heading", () => {
    expect(sessionList(repoSections([], []), ctx, { "blazetrailsdev/trails": "<i>x</i>" }).html).toContain("active</span><i>x</i>");
  });
});

describe("sessionDetail / sessionGroups, directly", () => {
  it("draws a live session's detail with its pane's terminal, facts and Open pane link", () => {
    const html = sessionDetail(PR, context({ screens: new Map([["%214", { html: '<span class="fg2">$ pnpm test</span>', notice: "", bad: false }]]) }), null);

    expect(html.startsWith('<div class="detail" id="' + sessionKey(PR) + '-detail">')).toBe(true);
    expect(html).toContain('data-terminal="%214"');
    expect(html).toContain('<span class="fg2">$ pnpm test</span></pre>');
    expect(html).not.toContain("Session log");
    expect(html).toContain('href="/panes/214">Open pane <svg');
    expect(html).toContain('data-action="pane-end" data-pane="%214"');
    expect(html.indexOf("End pane")).toBeGreaterThan(html.indexOf("Open pane"));
  });

  it("draws a live session's events beside its terminal, the operator's own lines among them", () => {
    const key = sessionKey(PR);
    const log = new Map([[key, [
      { key, at: "2026-11-15T10:00:00Z", kind: "event", text: "CI failed" },
      { key, at: "2026-11-15T10:01:00Z", kind: "you", text: "please rebase" },
    ]]]);
    const html = sessionDetail(PR, context({ log }), null);

    expect(html).toContain('data-terminal="%214"');
    expect(html).toContain("<h4>Events</h4>");
    expect(html).toContain('<div class="log-row log-you"');
    expect(html).toContain("please rebase");
    expect(html).toContain("CI failed");
    expect(html.indexOf("data-terminal")).toBeLessThan(html.indexOf("<h4>Events</h4>"));
  });

  it("draws a merged session's detail with its session log, not a terminal", () => {
    const html = sessionDetail({ ...PR, merged: true }, context(), null);

    expect(html).toContain("Session log");
    expect(html).not.toContain("data-terminal");
  });

  it("splits each repo's rows into active ones and merged ones, spawns first", () => {
    const merged = { ...PR, pr: 1, merged: true };
    const [group] = sessionGroups(repoSections([PR, merged], [SPAWN]));

    expect(group.rows).toEqual([SPAWN, PR]);
    expect(group.merged).toEqual([merged]);
  });
});

describe("terminalPanes / terminalHtml", () => {
  it("names each open, live session's worker pane once, and no other", () => {
    const rows = [PR, { ...PR, pr: 2 }, SPAWN, { ...PR, pr: 3, pane: "%9", merged: true }, { ...SPAWN, branch: "x", pane: "not-a-pane" }];
    const open = new Set(rows.map(sessionKey));

    expect(terminalPanes(rows, open)).toEqual(["%214", "%251"]);
    expect(terminalPanes(rows, new Set([sessionKey(SPAWN)]))).toEqual(["%251"]);
    expect(terminalPanes(rows, new Set())).toEqual([]);
  });

  it("draws a terminal that says it is connecting before its first screen", () => {
    const html = terminalHtml("%214", undefined);

    expect(html).toContain("connecting…");
    expect(html).toContain('<pre class="terminal" tabindex="0" data-terminal="%214" data-log="term-%214" aria-label="Pane %214 screen"></pre>');
  });

  it("draws a failing poll's notice in red, and keeps the last screen", () => {
    const html = terminalHtml("%214", { html: "<b>last</b>", notice: "ringo is unreachable", bad: true });

    expect(html).toContain('<span class="pane-notice bad" data-terminal-notice="%214" role="status">ringo is unreachable</span>');
    expect(html).toContain("<b>last</b></pre>");
  });
});

describe("suggestHtml", () => {
  const screen = { html: '&gt;&nbsp;<span style="opacity:.65;">run "the" tests</span>' };

  it("offers a Send suggestion button that types the dimmed suggestion into the pane", () => {
    const html = suggestHtml("%11", "k", screen);
    expect(html).toContain('data-action="pane-send"');
    expect(html).toContain('data-pane="%11"');
    expect(html).toContain('data-says="compose-note-k"');
    expect(html).toContain('data-text="run &quot;the&quot; tests"');
    expect(html).toContain('aria-describedby="suggest-k"');
    expect(html).toContain('id="suggest-k">run &quot;the&quot; tests</span>');
  });

  it("labels its button in plain text, so the busy label restores to exactly that", () => {
    const html = suggestHtml("%11", "k", screen);
    const label = /<button[^>]*>([^<]*)<\/button>/.exec(html)[1];
    expect(label).toBe("Send suggestion");
    const request = controlRequest("pane-send", { pane: "%11", text: "run tests", key: "k", says: "compose-note-k" });
    expect(controlOutcome(request, { ok: true, text: "" }, label).text).toBe("Send suggestion");
    expect(controlOutcome(request, { error: "offline" }, label).text).toBe("Send suggestion");
  });

  it("draws nothing without a suggestion or a screen", () => {
    expect(suggestHtml("%11", "k", { html: "&gt; typed" })).toBe("");
    expect(suggestHtml("%11", "k", undefined)).toBe("");
  });
});
