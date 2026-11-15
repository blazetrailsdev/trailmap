import { describe, expect, it } from "vitest";
import { esc, repoSections, reviewersByKey } from "../../app/assets/javascripts/fleet-format.js";
import {
  STALL_MS,
  STORIES_MAX_REFS,
  askFor,
  askRow,
  askStrip,
  branchStory,
  filterChips,
  filterFrom,
  filterUrl,
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
  prRef,
  reportedStage,
  reviewRing,
  reviewTurn,
  sessionCard,
  sessionDetail,
  sessionGroups,
  sessionKey,
  sessionList,
  sessionNeeds,
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
    expect(sessionCard(PR, context({ stories: STORIES }))).toContain('<a class="story lead" href="/story/preview-interceptors"');
  });

  it("lists the bundle's other stories as links to their pages", () => {
    expect(sessionCard(PR, context({ stories: STORIES }))).toContain('<a class="story" href="/story/interceptor-string-arm"');
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
    expect(list.html.startsWith('<article class="session session-drafting needs orphan-ask">')).toBe(true);
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

  it("fills the side whose turn it is, and spins only while a side works", () => {
    const owed = reviewRing({ ...PR, paneStatus: "idle", reviewCycles: 2 }, { review_owed: true, pane_id: "%9" });
    const working = reviewRing({ ...PR, paneStatus: "working", reviewCycles: 2 }, null);

    expect(owed).toContain('class="ring-side bottom turn"');
    expect(owed).not.toContain("spinning");
    expect(working).toContain('class="ring-side top turn"');
    expect(working).toContain("ring spinning");
  });

  it("carries one label with the round and both lines", () => {
    const html = reviewRing({ ...PR, paneStatus: "idle", reviewCycles: 3, lastAction: "pushed <fix>" }, { pane_status: "working" });

    expect(html).toContain('aria-label="Review round 3. Agent: pushed &lt;fix&gt;. Reviewer: reviewing."');
    expect(html).toContain('<span class="ring-round">3</span>');
  });

  it("stands in for the icon at Reviewer convergence and nowhere else", () => {
    const reviewers = reviewersByKey([{ owner: PR.owner, repo: PR.repo, pr: PR.pr, agent: "codex" }]);

    expect(sessionCard(PR, context({ reviewers }))).toContain('class="ring');
    expect(sessionCard({ ...PR, ciStatus: "success" }, context())).not.toContain('class="ring');
    expect(sessionCard({ ...PR, merged: true, reviewCycles: 2 }, context({ reviewers }))).not.toContain('class="ring');
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

  it("is tinted and labelled, and sorts first in its repo whatever its stage", () => {
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

  it("is not counted under Needs you", () => {
    expect(sessionNeeds({ ...PR, ciStatus: "failure" }, context(), fixer)).toBe(false);
  });
});

describe("sessionNeeds", () => {
  it("keeps an open question, a failed check, a stall and a merge waiting", () => {
    expect(sessionNeeds(PR, context({ asks: [{ pane: "%214" }] }))).toBe(true);
    expect(sessionNeeds({ ...PR, ciStatus: "failure" }, context())).toBe(true);
    expect(sessionNeeds({ ...PR, ciStatus: "success" }, context())).toBe(true);
    const stalled = { ...PR, ciStatus: "pending", paneStatus: "idle", draft: true };
    expect(sessionNeeds(stalled, context({ panes: idleSince("%214", 30) }))).toBe(true);
  });

  it("drops everything else, merged sessions and grooming agents included", () => {
    expect(sessionNeeds({ ...PR, ciStatus: "pending" }, context())).toBe(false);
    expect(sessionNeeds({ ...PR, merged: true, ciStatus: "failure" }, context())).toBe(false);
    expect(sessionNeeds({ kind: "rfc-refine" }, context())).toBe(false);
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
  it("links the PR, shows the stage by its stepper, and the note and its age", () => {
    const html = sessionCard({ ...PR, lastAction: "pushed <fix>", lastTime: minutesAgo(6) }, context());

    expect(html).toContain('<a class="pr-link" href="https://github.com/blazetrailsdev/trails/pull/9958" target="_blank">trails#9958</a>');
    expect(html).toContain('aria-label="Stage: Getting CI green"');
    expect(html).toContain('class="session session-ci"');
    expect(html).toContain("pushed &lt;fix&gt;");
    expect(html).toContain(">6m ago</button>");
  });

  it("flags a failed check beside the PR link", () => {
    const html = sessionCard({ ...PR, ciStatus: "failure" }, context());

    expect(html).toContain("check failed</span>");
    expect(html.indexOf("pr-link")).toBeLessThan(html.indexOf("check failed"));
    expect(sessionCard({ ...PR, ciStatus: "pending" }, context())).not.toContain("check failed");
  });

  it("offers Merge on Ready to merge rows only, in place of the figure", () => {
    const ready = sessionCard({ ...PR, ciStatus: "success" }, context());

    expect(ready).toContain('data-action="merge" data-owner="blazetrailsdev" data-repo="trails" data-pr="9958"');
    expect(ready).not.toContain('class="figure"');
    expect(sessionCard({ ...PR, ciStatus: "failure" }, context())).not.toContain('data-action="merge"');
    expect(sessionCard({ ...PR, ciStatus: "success", draft: true }, context())).not.toContain('data-action="merge"');
    expect(sessionCard({ ...PR, ciStatus: "success", merged: true }, context())).not.toContain('data-action="merge"');
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
    expect(html).toContain('<a class="btn btn-sm" href="/panes/214">Open pane</a>');
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

  it("orders a repo's sessions by stage, Drafting first, ties in ringo's order, grooming last", () => {
    const ci = { ...PR, pr: 1 };
    const ready = { ...PR, pr: 2, ciStatus: "success" };
    const ci2 = { ...PR, pr: 3 };
    const groom = { kind: "rfc-refine", story_id: "r" };

    expect(orderSessions([groom, ready, ci, SPAWN, ci2], ctx).map((s) => s.pr ?? s.story_id)).toEqual([
      "move-tracker-state", 1, 3, 2, "r",
    ]);
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

    expect(list.html).toContain('<h2>blazetrailsdev/trails</h2><span class="muted">2 active</span>');
    expect(list.active).toBe(2);
  });

  it("counts what Needs you keeps, and marks the repos that have any", () => {
    const list = sessionList(repoSections([{ ...PR, ciStatus: "failure" }, { owner: "o", repo: "quiet", pr: 4 }], []), ctx);

    expect(list.needs).toBe(1);
    expect(list.html).toContain('<section class="repo has-needs" aria-label="blazetrailsdev/trails">');
    expect(list.html).toContain('<section class="repo" aria-label="o/quiet">');
  });

  it("puts a fixer with no session of its own first in its repo", () => {
    const list = sessionList(repoSections([PR], []), context({ fixers: [{ owner: "blazetrailsdev", repo: "trails", consecutive_red: 1 }] }));

    expect(list.html.indexOf("session-drafting fixer")).toBeLessThan(list.html.indexOf(sessionKey(PR)));
  });

  it("puts a repo's own extras, the clear-failed button, beside its heading", () => {
    expect(sessionList(repoSections([], []), ctx, { "blazetrailsdev/trails": "<i>x</i>" }).html).toContain("active</span><i>x</i>");
  });
});

describe("the filter", () => {
  it("draws both chips with their counts and which one is pressed", () => {
    const html = filterChips(7, 2, "needs");

    expect(html).toContain('data-filter="all" aria-pressed="false">All 7</button>');
    expect(html).toContain('data-filter="needs" aria-pressed="true">Needs you 2</button>');
  });

  it("opens filtered from ?filter=needs, and writes it back", () => {
    expect(filterFrom("?filter=needs")).toBe("needs");
    expect(filterFrom("?filter=bogus")).toBe("all");
    expect(filterFrom("")).toBe("all");
    expect(filterUrl("https://t/dashboard?x=1", "needs")).toBe("/dashboard?x=1&filter=needs");
    expect(filterUrl("https://t/dashboard?filter=needs", "all")).toBe("/dashboard");
  });
});

describe("sessionDetail / sessionGroups, directly", () => {
  it("draws the detail for a session with its log, facts and Open pane link", () => {
    const html = sessionDetail(PR, context(), null);

    expect(html.startsWith('<div class="detail" id="' + sessionKey(PR) + '-detail">')).toBe(true);
    expect(html).toContain("Session log");
    expect(html).toContain('href="/panes/214">Open pane</a>');
  });

  it("splits each repo's rows into active ones and merged ones, spawns first", () => {
    const merged = { ...PR, pr: 1, merged: true };
    const [group] = sessionGroups(repoSections([PR, merged], [SPAWN]));

    expect(group.rows).toEqual([SPAWN, PR]);
    expect(group.merged).toEqual([merged]);
  });
});
