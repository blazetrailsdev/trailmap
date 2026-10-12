import { describe, expect, it } from "vitest";
import {
  CLEAR_FAILED_ID,
  DEFAULT_REPO,
  anyFailedSpawn,
  control,
  controlOutcome,
  controlRequest,
  REV_EMOJI,
  WORK_EMOJI,
  activeFixers,
  agentChip,
  ciIcon,
  esc,
  fixerCards,
  fixerPhase,
  fixerSummary,
  isFixerPR,
  isFixerStory,
  mainCIByRepo,
  mainCITitle,
  paneDot,
  paneHref,
  paneLine,
  prRow,
  reconnectDelay,
  pullFailLabel,
  pullFailReason,
  pullFailTitle,
  repoOf,
  repoSectionScaffold,
  repoSections,
  repoSectionsKey,
  reviewerKey,
  reviewerLine,
  reviewersByKey,
  rfcSpawnRow,
  row,
  sectionId,
  spawnLoopControls,
  spawnLoopView,
  spawnRow,
  statusClass,
  timeAgo,
  visibleSpawns,
  askAnswer,
  askCards,
  askSummary,
  barColor,
  claudeUsage,
  codexUsage,
  dayMarkers,
  drainStatus,
  formatClockLabel,
  formatResetLabel,
  messageKind,
  paceText,
  parseResetDate,
  pokeButton,
  queueCard,
  redPanes,
  strandedAgents,
  weekElapsedPercent,
  weeklyPaceColor,
  hoursUntilReset,
  queuedUnder,
  resetDate,
} from "../../app/assets/javascripts/fleet-format.js";

import { isPaneId } from "../../config/fleet.ts";

/**
 * The fleet dashboard's formatting half, which is where all of its decisions
 * live. `dashboard.js` around it is `innerHTML =` and an `EventSource`.
 *
 * `now` is injected everywhere a relative time is rendered, so nothing here
 * races the clock.
 */
const NOW = Date.parse("2026-09-08T12:00:00Z");
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();

describe("esc", () => {
  it("escapes every character that could break out of text or an attribute", () => {
    expect(esc(`<script>&"'`)).toBe("&lt;script&gt;&amp;&quot;&#39;");
  });

  it("renders null and undefined as empty, not as the words", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});

describe("timeAgo", () => {
  it("counts in the largest unit that is still a whole number", () => {
    expect(timeAgo(minutesAgo(0.5), NOW)).toBe("30s ago");
    expect(timeAgo(minutesAgo(5), NOW)).toBe("5m ago");
    expect(timeAgo(minutesAgo(150), NOW)).toBe("2h ago");
    expect(timeAgo(minutesAgo(60 * 24 * 3), NOW)).toBe("3d ago");
  });
});

describe("statusClass", () => {
  it("slugs a next-action phrase into ringo's class name", () => {
    expect(statusClass("waiting for CI")).toBe("status status-waiting-for-ci");
    expect(statusClass("limit reached")).toBe("status status-limit-reached");
  });

  it("survives a missing next action rather than emitting `status-null`", () => {
    expect(statusClass(null)).toBe("status status-");
  });
});

describe("paneDot", () => {
  it("gives the limit state its own glyph, not just its own colour", () => {
    expect(paneDot("limit")).toContain("◑");
    expect(paneDot("limit")).toContain("var(--purple)");
    // The whole sentence: an exhausted agent is not stuck, it is waiting.
    expect(paneDot("limit")).toContain("stopped until the quota resets");
  });

  it("uses a filled dot for the states that mean something is happening", () => {
    for (const status of ["working", "waiting", "error"]) expect(paneDot(status)).toContain("●");
    expect(paneDot("working")).toContain("var(--green)");
    expect(paneDot("waiting")).toContain("var(--yellow)");
    expect(paneDot("error")).toContain("var(--red)");
  });

  it("falls back to the muted idle ring for an unknown or missing status", () => {
    expect(paneDot(undefined)).toContain("○");
    expect(paneDot("nonsense")).toContain("var(--muted)");
  });
});

describe("ciIcon", () => {
  it("colours the rollup by this PR's own check state", () => {
    expect(ciIcon("success")).toContain("ci-success");
    expect(ciIcon("failure")).toContain("ci-failure");
    expect(ciIcon("pending")).toContain("ci-pending");
  });

  it("titles each state in words, not just colour", () => {
    expect(ciIcon("success")).toContain('title="CI passing"');
    expect(ciIcon("failure")).toContain('title="CI failing"');
    expect(ciIcon("pending")).toContain('title="CI running"');
  });

  it("renders nothing when the checks have not reported", () => {
    expect(ciIcon(undefined)).toBe("");
    expect(ciIcon("")).toBe("");
    expect(ciIcon("something-new")).toBe("");
  });
});

describe("paneLine", () => {
  it("renders the pane id and its dot", () => {
    const line = paneLine("💪", "%214", "working");

    expect(line).toContain("<code>%214</code>");
    expect(line).toContain("working");
  });

  it("links the pane id to its live view, whichever row it sits on", () => {
    const link = '<a class="pane-link" href="/panes/214" title="watch this pane live"><code>%214</code></a>';

    expect(paneLine("💪", "%214", "working")).toContain(link);
    expect(paneLine("📋", "%214", "idle")).toContain(link);
    expect(prRow({ owner: "o", repo: "r", pr: 1, pane: "%214" })).toContain(link);
    expect(spawnRow({ pane: "%214", task: "t" })).toContain(link);
    expect(rfcSpawnRow({ pane: "%214", rfc: "0136-trailmap" })).toContain(link);
  });

  it("leaves an id that is not a tmux pane id as escaped text, not a link", () => {
    expect(paneHref("%214")).toBe("/panes/214");
    for (const pane of ["214", "%", "%2x", "%1/../x", undefined, ""]) expect(paneHref(pane)).toBe("");

    const line = paneLine("💪", '%1"><script>', "working");
    expect(line).not.toContain("<a ");
    expect(line).toContain("<code>%1&quot;&gt;&lt;script&gt;</code>");
  });

  // Two regexes, one in the browser and one on the server, that cannot share
  // code. A link `paneHref` makes must be one the page and relay accept, and
  // an id they accept must be one it links.
  it("links exactly the ids the server accepts", () => {
    for (const digits of ["0", "7", "42", "1234567890", "12345678901", "", "4x", "-1", "4.2", " 42", "٤٢", "../1"]) {
      expect(paneHref("%" + digits) !== "", JSON.stringify(digits)).toBe(isPaneId(digits));
    }
    expect(isPaneId(paneHref("%214").replace("/panes/", ""))).toBe(true);
  });

  it("names the role behind the emoji, for anyone who cannot read it", () => {
    expect(paneLine("💪", "%214", "working")).toContain('title="worker"');
    expect(paneLine("📋", "%215", "working")).toContain('title="reviewer"');
  });

  it("puts a lead -- the reviewer's agent chip -- before the id, as ringo does", () => {
    const line = paneLine("📋", "%215", "idle", '<span class="agent-chip">claude</span>');

    expect(line).toContain('<span class="pval"><span class="agent-chip">claude</span><a ');
  });

  it("renders nothing at all when there is no pane", () => {
    expect(paneLine("💪", "", "working")).toBe("");
    expect(paneLine("💪", undefined, undefined)).toBe("");
  });
});

describe("reviewerKey", () => {
  it("is ringo's own key for its reviewer list: owner/repo#pr", () => {
    expect(reviewerKey("blazetrailsdev", "trailmap", 47)).toBe("blazetrailsdev/trailmap#47");
  });

  // ringo keys `_reviewers` this way (`dashboard.go:816`), and the list it
  // serves is looked up by it. A different spelling here finds nothing.
  it("is what reviewersByKey files an entry under", () => {
    const entry = { owner: "o", repo: "r", pr: 3, agent: "claude" };

    expect(reviewersByKey([entry])[reviewerKey("o", "r", 3)]).toBe(entry);
  });
});

describe("the mini-table's two labels", () => {
  it("are the emoji ringo uses, which is how a row's two lines are told apart", () => {
    expect(WORK_EMOJI).toBe("💪");
    expect(REV_EMOJI).toBe("📋");
  });
});

describe("reviewerLine", () => {
  const pr = { owner: "blazetrailsdev", repo: "trailmap", pr: 47 };
  const reviewers = reviewersByKey([
    { owner: "blazetrailsdev", repo: "trailmap", pr: 47, agent: "claude", pane_id: "%215", pane_status: "working" },
  ]);

  it("gives the reviewer the worker's own shape: agent, pane link, status dot", () => {
    const line = reviewerLine(pr, reviewers);

    expect(line).toContain('title="reviewer"');
    expect(line).toContain("📋");
    expect(line).toContain(">claude</span>");
    expect(line).toContain('href="/panes/215"');
    expect(line).toContain('title="working"');
  });

  it("keys by repo as well as number, so trails#47 is not trailmap#47", () => {
    expect(reviewerLine({ owner: "blazetrailsdev", repo: "trails", pr: 47 }, reviewers)).not.toContain("%215");
    expect(reviewerLine({ owner: "blazetrailsdev", repo: "trails", pr: 47 }, reviewers)).toContain("—");
  });

  it("says so when no reviewer is assigned, rather than leaving the row off", () => {
    const line = reviewerLine(pr, {});

    expect(line).toContain('class="pcell unassigned"');
    // `.empty` is the list pages' empty-state block: a cell wearing it gets
    // 32px of padding and tears the reviewer line off the worker's.
    expect(line).not.toContain("pcell empty");
    expect(line).toContain("—");
    expect(line).not.toContain("<code>");
  });

  it("keeps the agent, and drops to a dash, when the reviewer's pane has gone", () => {
    const pinned = reviewersByKey([{ ...pr, agent: "codex" }]);
    const line = reviewerLine(pr, pinned);

    expect(line).toContain(">codex</span>");
    expect(line).toContain("—");
    expect(line).not.toContain('href="/panes/');
  });

  it("marks an agent blocked by its usage limit, which no pane status says", () => {
    const blocked = reviewersByKey([{ ...pr, agent: "codex", pane_id: "%9", blocked_by_usage: true }]);

    expect(reviewerLine(pr, blocked)).toContain("agent-chip blocked");
    expect(reviewerLine(pr, blocked)).toContain("blocked by its usage limit");
    expect(reviewerLine(pr, reviewers)).not.toContain("blocked");
  });

  it("escapes the agent, which is ringo's string and not ours", () => {
    expect(agentChip('<script>', false)).toContain("&lt;script&gt;");
    expect(agentChip("", false)).toBe("");
  });

  it("ignores a hole in ringo's list rather than throwing on it", () => {
    expect(reviewersByKey([null])).toEqual({});
    expect(reviewersByKey([])).toEqual({});
  });

  // The page's choice is between "nobody is reviewing this" and "I do not
  // know", and it can only make it if a malformed body is told apart from an
  // empty list. Naming the type is what puts the reason in the warning.
  it("refuses a body that is not a list, by name, rather than iterating it", () => {
    expect(() => reviewersByKey({})).toThrow("not an array: object");
    expect(() => reviewersByKey(null)).toThrow("not an array: null");
    expect(() => reviewersByKey("[]")).toThrow("not an array: string");
    expect(() => reviewersByKey(undefined)).toThrow("not an array: undefined");
  });
});

describe("reviewerLine before an answer has arrived", () => {
  const pr = { owner: "blazetrailsdev", repo: "trailmap", pr: 47 };

  /*
   * The dash is a CLAIM: it says nobody is reviewing this PR. Before the first
   * poll lands -- and for as long as every poll fails, which is every page
   * load with RINGO_BASE unset or ringo unreachable -- the truth is "unknown",
   * and a page that answers an outage with "nobody is reviewing anything"
   * would be at its most confident exactly when it knows least.
   */
  it("says nothing at all while there is no answer, rather than claiming nobody", () => {
    expect(reviewerLine(pr, null)).toBe("");
    expect(reviewerLine(pr, undefined)).toBe("");
    expect(reviewerLine(pr)).toBe("");
  });

  it("claims nobody only once ringo has answered with an empty list", () => {
    expect(reviewerLine(pr, reviewersByKey([]))).toContain("—");
    expect(reviewerLine(pr, reviewersByKey([]))).toContain('class="pcell unassigned"');
  });
});

describe("prRow's pane mini-table", () => {
  const pr = { owner: "blazetrailsdev", repo: "trailmap", pr: 47, pane: "%214", paneStatus: "working" };
  const reviewers = reviewersByKey([
    { owner: "blazetrailsdev", repo: "trailmap", pr: 47, agent: "claude", pane_id: "%215", pane_status: "idle" },
  ]);

  it("puts the reviewer's pane under the worker's, in that order", () => {
    const row = prRow(pr, [], Date.now(), reviewers);

    expect(row).toContain('href="/panes/214"');
    expect(row).toContain('href="/panes/215"');
    expect(row.indexOf("/panes/214")).toBeLessThan(row.indexOf("/panes/215"));
  });

  // The merge BUTTON goes when the PR is merged and the reviewer does not:
  // one is an action that no longer exists, the other is information, and who
  // reviewed a PR is most wanted while reading the merge. ringo keeps it too.
  it("keeps the reviewer row on a merged PR, where the merge button goes", () => {
    const row = prRow({ ...pr, merged: true }, [], Date.now(), reviewers);

    expect(row).toContain('href="/panes/215"');
    expect(row).toContain(">claude</span>");
    expect(row).not.toContain('data-action="merge"');
  });

  it("carries no reviewer line at all until the list has been answered", () => {
    const unanswered = prRow(pr, [], Date.now(), null);

    expect(unanswered).toContain('href="/panes/214"');
    expect(unanswered).not.toContain("📋");
    expect(unanswered).not.toContain("pcell unassigned");
    // The default is the unanswered one: a caller that knows nothing about
    // reviewers must not make the page claim there are none.
    expect(prRow(pr, [], Date.now())).toBe(unanswered);
  });

  it("shows the reviewer even on a PR with no worker pane of its own", () => {
    const row = prRow({ ...pr, pane: undefined, paneStatus: undefined }, [], Date.now(), reviewers);

    expect(row).not.toContain('href="/panes/214"');
    expect(row).toContain('href="/panes/215"');
  });
});

describe("isFixerStory / isFixerPR", () => {
  const fixers = [{ owner: "blazetrailsdev", repo: "trails", pr: 4022, story_id: "fix-red-main" }];

  it("matches the fixer's own story and PR", () => {
    expect(isFixerStory(fixers, "fix-red-main")).toBe(true);
    expect(isFixerPR(fixers, { owner: "blazetrailsdev", repo: "trails", pr: 4022 })).toBe(true);
  });

  it("requires the repo to match too, not just the PR number", () => {
    expect(isFixerPR(fixers, { owner: "blazetrailsdev", repo: "tasks", pr: 4022 })).toBe(false);
  });

  it("is false for a missing id and for an empty fixer list", () => {
    expect(isFixerStory(fixers, undefined)).toBe(false);
    expect(isFixerStory([], "fix-red-main")).toBe(false);
    expect(isFixerPR(undefined, { owner: "a", repo: "b", pr: 1 })).toBe(false);
  });
});

describe("activeFixers", () => {
  it("keeps a repo in any of the four phases", () => {
    const list = [
      { repo: "a", story_id: "s" },
      { repo: "b", paused: true },
      { repo: "c", recovering: true },
      { repo: "d", consecutive_red: 2 },
    ];

    expect(activeFixers(list)).toHaveLength(4);
  });

  it("drops a repo that is simply green, so no card is drawn for it", () => {
    expect(activeFixers([{ repo: "a", consecutive_red: 0 }])).toEqual([]);
    expect(activeFixers(undefined)).toEqual([]);
  });
});

describe("fixerPhase", () => {
  it("reports paused ahead of fixing — the stopped loop is the bigger fact", () => {
    expect(fixerPhase({ paused: true, story_id: "s" })).toBe("paused");
  });

  it("reports recovering ahead of everything, since main is green again", () => {
    expect(fixerPhase({ recovering: true, paused: true, story_id: "s" })).toBe("recovering");
  });

  it("is fixing with a worker on it, and red with none", () => {
    expect(fixerPhase({ story_id: "s" })).toBe("fixing");
    expect(fixerPhase({ consecutive_red: 1 })).toBe("red");
  });
});

describe("fixerSummary", () => {
  it("says the loop is paused whenever any repo has paused it", () => {
    expect(fixerSummary([{ repo: "a" }, { repo: "b", paused: true }])).toBe(
      "spawn loop paused — waiting on main to recover",
    );
  });

  it("counts repos otherwise, singular and plural", () => {
    expect(fixerSummary([{ repo: "a" }])).toBe("main is red");
    expect(fixerSummary([{ repo: "a" }, { repo: "b" }])).toBe("2 repos red");
  });
});

describe("fixerCards", () => {
  const paused = {
    owner: "blazetrailsdev",
    repo: "trails",
    paused: true,
    consecutive_red: 3,
    checks: ["test (node 24)", "typecheck"],
    red_sha: "9f31ca77b1e2",
    red_url: "https://github.com/blazetrailsdev/trails/actions/runs/1",
    story_id: "fix-red-main",
    pr: 4022,
    awaiting_rebase: [4021, 4018],
  };

  it("marks the phase and the consecutive-red count", () => {
    const html = fixerCards([paused]);

    expect(html).toContain('<span class="fixer-phase paused">paused</span>');
    expect(html).toContain("3&times; consecutive red");
  });

  it("names the failing checks and links the red commit, truncated to 8", () => {
    const html = fixerCards([paused]);

    expect(html).toContain("test (node 24), typecheck");
    expect(html).toContain("<code>9f31ca77</code>");
    expect(html).toContain('href="https://github.com/blazetrailsdev/trails/actions/runs/1"');
  });

  it("links the fixer's story and PR, and the PRs waiting on the rebase", () => {
    const html = fixerCards([paused]);

    expect(html).toContain('href="/story/fix-red-main"');
    expect(html).toContain('href="https://github.com/blazetrailsdev/trails/pull/4022"');
    expect(html).toContain('href="https://github.com/blazetrailsdev/trails/pull/4021"');
    expect(html).toContain('href="https://github.com/blazetrailsdev/trails/pull/4018"');
  });

  it("omits a line rather than rendering an empty one", () => {
    const html = fixerCards([{ owner: "o", repo: "r", consecutive_red: 1 }]);

    expect(html).not.toContain("fixer:");
    expect(html).not.toContain("awaiting rebase:");
    expect(html).not.toContain("red:");
    expect(html).not.toContain("consecutive red");
  });

  it("escapes a check name rather than letting it into the markup", () => {
    const html = fixerCards([{ owner: "o", repo: "r", checks: ["<img onerror=x>"], consecutive_red: 1 }]);

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img onerror=x&gt;");
  });
});

describe("row", () => {
  it("omits the aside and the pane block when there is nothing to put in them", () => {
    const html = row({ icon: "pr", title: "t", meta: "m" });

    expect(html).not.toContain("aside-top");
    expect(html).not.toContain('class="panes"');
  });
});

describe("reconnectDelay", () => {
  it("retries at once, then doubles from a second to a ceiling of thirty", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map(reconnectDelay)).toEqual([
      0, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });
});

describe("control", () => {
  it("carries its action and arguments as data attributes, escaped", () => {
    const html = control("dismiss", { branch: `x" onclick="alert(1)` }, {
      cls: "spawn-dismiss",
      title: "Dismiss <this>",
      label: "&times;",
    });

    expect(html).toContain('data-action="dismiss"');
    expect(html).toContain('data-branch="x&quot; onclick=&quot;alert(1)"');
    expect(html).toContain('title="Dismiss &lt;this&gt;"');
    expect(html).not.toContain("onclick=\"");
  });

  it("can be drawn hidden, with an id to find it by", () => {
    const html = control("clear-failed", {}, { cls: "c", title: "t", label: "l", id: "x", hidden: true });

    expect(html).toContain('id="x"');
    expect(html).toContain('style="display:none"');
  });
});

describe("controlRequest", () => {
  it("merges through ringo's gate, asking first and reporting on the button", () => {
    const request = controlRequest("merge", { owner: "o", repo: "r", pr: "7" });

    expect(request.path).toBe("/merge-pr");
    expect(request.body).toEqual({ owner: "o", repo: "r", pr: 7 });
    expect(request.confirm).toBe("Merge o/r#7?");
    expect([request.busy, request.done, request.failed, request.errored]).toEqual([
      "...",
      "merged",
      "fail",
      "err",
    ]);
    expect(request.resetAfterMs).toBe(5000);
    expect(request.failureAlert("needs review")).toBe("Merge blocked for o/r#7:\n\nneeds review");
    expect(request.errorAlert("offline")).toBe("Merge error for o/r#7:\n\noffline");
  });

  it("respawns a fixer, asking first", () => {
    const request = controlRequest("respawn-fixer", { owner: "o", repo: "r" });

    expect(request.path).toBe("/ci-fixer/spawn");
    expect(request.body).toEqual({ owner: "o", repo: "r" });
    expect(request.confirm).toBe("Discard the tracked fixer story and spawn a fresh fixer for o/r?");
    expect([request.busy, request.done]).toEqual(["spawning\u2026", "spawned"]);
    expect(request.failureAlert("nope")).toBe("Respawn failed: nope");
  });

  it("dismisses one failed spawn by branch, quietly and without asking", () => {
    expect(controlRequest("dismiss", { branch: "a-branch-1f2e" })).toEqual({
      path: "/spawnloop/dismiss",
      body: { branch: "a-branch-1f2e" },
      quiet: true,
    });
  });

  it("clears every failed spawn with a bodiless post", () => {
    expect(controlRequest("clear-failed", {})).toEqual({
      path: "/spawnloop/dismiss-failed",
      body: null,
      quiet: true,
    });
  });

  it("is null for a button that is not a control", () => {
    expect(controlRequest("spawn", {})).toBeNull();
  });
});

describe("controlOutcome", () => {
  const merge = controlRequest("merge", { owner: "o", repo: "r", pr: "7" });
  const respawn = controlRequest("respawn-fixer", { owner: "o", repo: "r" });
  const dismiss = controlRequest("dismiss", { branch: "b" });

  it("holds the merge button for the reset period on every outcome", () => {
    expect(controlOutcome(merge, { ok: true, text: "done" }, "merge")).toEqual({
      disabled: true,
      text: "merged",
      title: "done",
      resetAfterMs: 5000,
    });
    expect(controlOutcome(merge, { ok: false, text: "needs review" }, "merge")).toEqual({
      disabled: true,
      text: "fail",
      title: "needs review",
      alert: "Merge blocked for o/r#7:\n\nneeds review",
      resetAfterMs: 5000,
    });
    // ringo's button stays disabled through "err" too; a live button reading
    // "err" would take a second click as a second merge.
    expect(controlOutcome(merge, { error: "offline" }, "merge")).toEqual({
      disabled: true,
      text: "err",
      title: "offline",
      alert: "Merge error for o/r#7:\n\noffline",
      resetAfterMs: 5000,
    });
  });

  it("leaves a respawned fixer's button spent, and gives it straight back on a failure", () => {
    expect(controlOutcome(respawn, { ok: true, text: "ok" }, "respawn fixer")).toEqual({
      disabled: true,
      text: "spawned",
    });
    expect(controlOutcome(respawn, { ok: false, text: "no red recorded" }, "respawn fixer")).toEqual({
      disabled: false,
      text: "respawn fixer",
      alert: "Respawn failed: no red recorded",
    });
    expect(controlOutcome(respawn, { error: "offline" }, "spawn fixer")).toEqual({
      disabled: false,
      text: "spawn fixer",
      alert: "Respawn failed: offline",
    });
  });

  it("keeps a quiet control disabled only when it worked", () => {
    expect(controlOutcome(dismiss, { ok: true, text: "" }, "x")).toEqual({ disabled: true });
    expect(controlOutcome(dismiss, { ok: false, text: "gone" }, "x")).toEqual({ disabled: false });
    expect(controlOutcome(dismiss, { error: "offline" }, "x")).toEqual({ disabled: false });
  });
});

describe("the spawn loop's controls", () => {
  const STATE = { enabled: true, live_cap: 6, queue_cap: 12, stagger_seconds: 300 };

  it("posts what ringo's panel posts", () => {
    expect(controlRequest("loop-toggle", { enabled: "true" })).toMatchObject({
      path: "/spawnloop/config", body: { enabled: false },
    });
    expect(controlRequest("loop-toggle", { enabled: "false" }).body).toEqual({ enabled: true });
    expect(controlRequest("loop-skip", {})).toMatchObject({ path: "/spawnloop/skip", body: null });
    expect(controlRequest("loop-now", {})).toMatchObject({ path: "/spawnloop/spawn-now", body: null });
    expect(
      controlRequest("loop-settings", { liveCap: "6", queueCap: "12", interval: "5", bundle: true }).body,
    ).toEqual({ live_cap: 6, queue_cap: 12, stagger_seconds: 300, bundle_mode: true });
  });

  it("leaves a blank or zero setting out, so ringo keeps its own", () => {
    const { body } = controlRequest("loop-settings", { liveCap: "", queueCap: "0", interval: "0", bundle: false });

    expect(JSON.parse(JSON.stringify(body))).toEqual({ bundle_mode: false });
  });

  it("hands a setting's answer back as the loop's new state, and never holds the control", () => {
    const toggle = controlRequest("loop-toggle", { enabled: "false" });

    expect(controlOutcome(toggle, { ok: true, text: JSON.stringify(STATE) }, "play")).toEqual({
      disabled: false,
      state: STATE,
    });
    expect(controlOutcome(toggle, { ok: true, text: "not json" }, "play")).toEqual({ disabled: false });
    // A refusal or a failed fetch is said, where ringo swallows both.
    const refused = (text) => ({ disabled: false, alert: "Spawn loop not changed: " + text });
    expect(controlOutcome(toggle, { ok: false, text: "bad request" }, "play")).toEqual(refused("bad request"));
    expect(controlOutcome(toggle, { error: "offline" }, "play")).toEqual(refused("offline"));
  });

  it("holds spawn now while the tick registers, then asks for a re-read", () => {
    const now = controlRequest("loop-now", {});

    expect(now.busy).toBe("spawning…");
    expect(controlOutcome(now, { ok: true, text: "" }, "spawn now")).toEqual({
      disabled: true, text: "spawning…", resetAfterMs: 1500, refresh: "spawn-loop",
    });
    expect(controlOutcome(now, { error: "offline" }, "spawn now")).toMatchObject({
      disabled: true, text: "spawn now", alert: "Spawn now failed: offline",
    });
  });

  it("draws every button through control", () => {
    const html = spawnLoopControls();

    for (const action of ["loop-toggle", "loop-now", "loop-skip"]) expect(html).toContain(`data-action="${action}"`);
    expect(html).toContain('id="slSkip" class="btn btn-sm" data-action="loop-skip" style="display:none"');
  });

  it("shows the loop's state, the next story and a skip for it", () => {
    const view = spawnLoopView(
      { ...STATE, live_now: 4, open_now: 9, last_spawn_at: NOW - 120000, next: { id: "a-story", title: "A <story>" } },
      NOW,
    );

    expect(view).toMatchObject({
      enabled: true, toggle: "pause", liveCap: 6, queueCap: 12, interval: 5, bundleMode: false,
      liveNow: "(now: 4)", openNow: "(now: 9)", next: "next: A <story>", nextTitle: "a-story",
      skip: true, bundleList: "",
    });
    expect(view.lastSpawn).toMatch(/^\(latest: .+\)$/);
    expect(spawnLoopView({}, NOW)).toMatchObject({
      enabled: false, toggle: "play", interval: 0, liveNow: "(now: 0)", lastSpawn: "",
      next: "next: nothing ready", skip: false,
    });
  });

  it("names the whole bundle in bundle mode, and offers no skip", () => {
    const bundle = [{ id: "a", title: "<A>", est_loc: 200 }, { id: "b/c" }];
    const view = spawnLoopView({ bundle_mode: true, next_bundle: bundle, next: { id: "a" } }, NOW);

    expect(view).toMatchObject({ next: "next bundle: 2 stories · ~200 LOC", nextTitle: "a\nb/c", skip: false });
    expect(view.bundleList).toContain('<span class="bl-loc">200 LOC</span>');
    expect(view.bundleList).toContain('<a href="/story/a" title="a">&lt;A&gt;</a>');
    expect(view.bundleList).toContain('<span class="bl-loc">—</span>');
    expect(view.bundleList).toContain('href="/story/b%2Fc"');
    expect(spawnLoopView({ bundle_mode: true, next_bundle: [{ id: "a" }] }, NOW).next).toBe("next bundle: 1 story");
    expect(spawnLoopView({ bundle_mode: true, next_bundle_err: "tasks: exit 1" }, NOW)).toMatchObject({
      next: "next bundle: unavailable", nextTitle: "tasks: exit 1",
    });
    expect(spawnLoopView({ bundle_mode: true }, NOW).next).toBe("next bundle: nothing ready");
  });
});

describe("the row controls", () => {
  const pr = { owner: "o", repo: "r", pr: 7, title: "t", nextAction: "ready to merge" };

  it("offers merge on an open PR, after its status", () => {
    const html = prRow(pr, [], NOW);

    expect(html).toContain('<button class="act merge" data-action="merge" data-owner="o" data-repo="r" data-pr="7"');
    expect(html.indexOf("status-ready-to-merge")).toBeLessThan(html.indexOf('data-action="merge"'));
  });

  it("drops merge once the PR has merged", () => {
    expect(prRow({ ...pr, merged: true }, [], NOW)).not.toContain('data-action="merge"');
  });

  it("offers dismiss on a failed spawn and on no other", () => {
    const spawn = { story_id: "a-story", branch: "a-story-1f2e", status: "failed", error: "boom" };

    expect(spawnRow(spawn, [], NOW)).toContain('data-action="dismiss" data-branch="a-story-1f2e"');
    expect(spawnRow({ ...spawn, status: "spawned" }, [], NOW)).not.toContain("data-action");
  });

  it("offers the fixer lever only while a red is recorded", () => {
    const red = { owner: "o", repo: "r", red_sha: "9f31ca77aa", consecutive_red: 1 };

    expect(fixerCards([red])).toContain('data-action="respawn-fixer" data-owner="o" data-repo="r"');
    expect(fixerCards([red])).toContain(">spawn fixer</button>");
    expect(fixerCards([{ ...red, story_id: "fix-red" }])).toContain(">respawn fixer</button>");
    expect(fixerCards([{ owner: "o", repo: "r", consecutive_red: 1 }])).not.toContain("data-action");
  });

  it("puts clear-failed on the default repo's heading, hidden until a spawn fails", () => {
    const html = repoSectionScaffold([{ name: DEFAULT_REPO }, { name: "o/other" }]);

    expect(html.match(/data-action="clear-failed"/g)).toHaveLength(1);
    expect(html).toContain('id="' + CLEAR_FAILED_ID + '"');
    expect(html).toContain('style="display:none"');
    expect(anyFailedSpawn([{ status: "spawned" }])).toBe(false);
    expect(anyFailedSpawn([{ status: "spawned" }, { status: "failed" }])).toBe(true);
  });
});

describe("prRow", () => {
  const base = {
    owner: "blazetrailsdev",
    repo: "trails",
    pr: 4021,
    title: "feat: a thing",
    branch: "a-thing",
    nextAction: "waiting for CI",
    pane: "%214",
    paneStatus: "working",
  };

  it("links GitHub and shows the workflow status", () => {
    const html = prRow(base, [], NOW);

    expect(html).toContain('href="https://github.com/blazetrailsdev/trails/pull/4021"');
    expect(html).toContain('<span class="status status-waiting-for-ci">waiting for CI</span>');
    expect(html).toContain("<code>%214</code>");
  });

  it("shows this PR's own CI rollup, next to its title", () => {
    expect(prRow({ ...base, ciStatus: "failure" }, [], NOW)).toContain("ci-failure");
    expect(prRow({ ...base, ciStatus: "success" }, [], NOW)).toContain("ci-success");
  });

  it("omits the rollup, rather than guessing, when CI has not reported", () => {
    expect(prRow(base, [], NOW)).not.toContain("ci-icon");
  });

  it("puts the rollup between the title and the labels, as ringo does", () => {
    const html = prRow({ ...base, ciStatus: "success", labels: ["actionview"] }, [], NOW);

    expect(html.indexOf("</a>")).toBeLessThan(html.indexOf("ci-icon"));
    expect(html.indexOf("ci-icon")).toBeLessThan(html.indexOf('class="label"'));
  });

  it("lets a limit-reached pane override the workflow status", () => {
    const html = prRow({ ...base, paneStatus: "limit" }, [], NOW);

    expect(html).toContain("limit reached");
    expect(html).not.toContain("waiting for CI");
  });

  it("lets a waiting pane override it too, and turns the icon yellow", () => {
    const html = prRow({ ...base, paneStatus: "waiting" }, [], NOW);

    expect(html).toContain("waiting for answer");
    expect(html).toContain('class="ricon waiting"');
  });

  it("uses the merge glyph once merged, and the muted one while draft", () => {
    expect(prRow({ ...base, merged: true }, [], NOW)).toContain('class="ricon merged"');
    expect(prRow({ ...base, draft: true }, [], NOW)).toContain('class="ricon draft"');
  });

  it("prefers merged over draft — a merged PR is not a draft any more", () => {
    expect(prRow({ ...base, merged: true, draft: true }, [], NOW)).toContain('class="ricon merged"');
  });

  it("badges the row when the in-flight CI fixer owns this PR", () => {
    const fixers = [{ owner: "blazetrailsdev", repo: "trails", pr: 4021 }];

    expect(prRow(base, fixers, NOW)).toContain("label-fixer");
    expect(prRow(base, [], NOW)).not.toContain("label-fixer");
  });

  it("shows a merge conflict and the PR's labels", () => {
    const html = prRow({ ...base, mergeConflict: true, labels: ["actionview"] }, [], NOW);

    expect(html).toContain('<span class="conflict">conflict</span>');
    expect(html).toContain('<span class="label">actionview</span>');
  });

  it("omits the counters entirely when there is nothing to count", () => {
    expect(prRow(base, [], NOW)).not.toContain("cycles");
  });

  it("singularises one comment", () => {
    expect(prRow({ ...base, commentCount: 1 }, [], NOW)).toContain("1 comment &middot;");
    expect(prRow({ ...base, commentCount: 3 }, [], NOW)).toContain("3 comments &middot;");
  });

  it("falls back to owner/repo#pr when the PR has no title yet", () => {
    expect(prRow({ ...base, title: "" }, [], NOW)).toContain("blazetrailsdev/trails#4021");
  });

  it("escapes a PR title rather than rendering it", () => {
    const html = prRow({ ...base, title: "<img onerror=x>" }, [], NOW);

    expect(html).not.toContain("<img");
  });
});

describe("spawnRow", () => {
  const base = {
    story_id: "move-tracker-state",
    title: "Move tracker state",
    branch: "move-tracker-state-7712",
    at: minutesAgo(6),
    source: "loop",
    pane: "%251",
    pane_status: "working",
  };

  it("links the story show page and says it is waiting for a PR", () => {
    const html = spawnRow(base, [], NOW);

    expect(html).toContain('href="/story/move-tracker-state"');
    expect(html).toContain("waiting for PR");
    expect(html).toContain("spawned 6m ago via loop");
  });

  it("says only `failed` for a failed spawn, and names the error", () => {
    const html = spawnRow({ ...base, status: "failed", error: "worktree exists" }, [], NOW);

    expect(html).toContain("status-failed");
    expect(html).toContain("worktree exists");
    expect(html).toContain('class="ricon failed"');
    // The pane is gone, so its last status is stale and must not be reported.
    expect(html).not.toContain("waiting for PR");
    expect(html).not.toContain("status-spawned");
  });

  it("lets a live pane's limit or waiting state override `waiting for PR`", () => {
    expect(spawnRow({ ...base, pane_status: "limit" }, [], NOW)).not.toContain("waiting for PR");
    expect(spawnRow({ ...base, pane_status: "waiting" }, [], NOW)).toContain("waiting for answer");
  });

  it("badges a spawn the CI fixer owns", () => {
    expect(spawnRow(base, [{ story_id: "move-tracker-state" }], NOW)).toContain("label-fixer");
  });

  it("hands a grooming agent to the RFC row instead", () => {
    const html = spawnRow({ ...base, kind: "rfc-refine", story_id: "0136-trailmap" }, [], NOW);

    expect(html).toContain('href="/rfc/0136-trailmap"');
    expect(html).not.toContain("waiting for PR");
  });
});

describe("rfcSpawnRow", () => {
  it("names the verb the agent is actually performing", () => {
    const s = { kind: "rfc-refine", story_id: "0136-trailmap", title: "trailmap" };

    expect(rfcSpawnRow(s, NOW)).toContain("refining");
    expect(rfcSpawnRow({ ...s, kind: "rfc-sunset" }, NOW)).toContain("sunsetting");
  });

  it("never claims to be waiting for a PR — it will never open one", () => {
    const html = rfcSpawnRow({ kind: "rfc-refine", story_id: "0136", title: "t" }, NOW);

    expect(html).not.toContain("waiting for PR");
  });
});

describe("repoOf / sectionId", () => {
  it("joins owner and repo, tolerating a row that carries only one", () => {
    expect(repoOf({ owner: "a", repo: "b" })).toBe("a/b");
    expect(repoOf({ repo: "b" })).toBe("b");
    expect(repoOf({})).toBe("");
  });

  it("makes a DOM-safe id out of a repo name", () => {
    expect(sectionId("blazetrailsdev/trails")).toBe("repo-blazetrailsdev-trails");
  });
});

describe("visibleSpawns", () => {
  const pr = { branch: "a-thing", pane: "%214" };

  it("drops a spawn whose branch already has a PR row", () => {
    expect(visibleSpawns([pr], [{ branch: "a-thing" }])).toEqual([]);
  });

  it("drops one whose story slug is the PR's branch, suffix and all", () => {
    expect(visibleSpawns([pr], [{ branch: "a-thing-7712", story_id: "a-thing" }])).toEqual([]);
  });

  it("drops one sharing the PR's tmux pane, when neither name matches", () => {
    expect(visibleSpawns([pr], [{ branch: "unrelated", story_id: "unrelated", pane: "%214" }])).toEqual([]);
  });

  it("keeps a spawn that has no PR yet", () => {
    expect(visibleSpawns([pr], [{ branch: "other", story_id: "other" }])).toHaveLength(1);
  });

  it("never suppresses a grooming agent, which opens no PR to be superseded by", () => {
    expect(visibleSpawns([pr], [{ kind: "rfc-refine", branch: "a-thing" }])).toHaveLength(1);
  });
});

describe("repoSections", () => {
  it("puts the default repo first and sorts the rest, whatever the payload order", () => {
    const prs = [
      { owner: "blazetrailsdev", repo: "trailmap", pr: 1 },
      { owner: "blazetrailsdev", repo: "tasks", pr: 2 },
      { owner: "blazetrailsdev", repo: "trails", pr: 3 },
    ];

    expect(repoSections(prs, []).map((s) => s.name)).toEqual([
      DEFAULT_REPO,
      "blazetrailsdev/tasks",
      "blazetrailsdev/trailmap",
    ]);
  });

  it("always shows the default repo, even with nothing open in it", () => {
    const sections = repoSections([], []);

    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe(DEFAULT_REPO);
    expect(sections[0].prs).toEqual([]);
  });

  it("leaves no empty heading for a repo with nothing in it", () => {
    const sections = repoSections([{ owner: "blazetrailsdev", repo: "tasks", pr: 1 }], []);

    expect(sections.map((s) => s.name)).toEqual([DEFAULT_REPO, "blazetrailsdev/tasks"]);
  });

  it("files a spawn under its own repo, and a routing-less one under the default", () => {
    const sections = repoSections([], [
      { story_id: "a", repo: "blazetrailsdev/tasks" },
      { story_id: "b" },
    ]);

    expect(sections.find((s) => s.name === DEFAULT_REPO).spawns.map((s) => s.story_id)).toEqual(["b"]);
    expect(sections.find((s) => s.name === "blazetrailsdev/tasks").spawns.map((s) => s.story_id)).toEqual(["a"]);
  });
});

describe("repoSectionScaffold", () => {
  it("gives each repo a heading and the two boxes, spawns hidden until needed", () => {
    const html = repoSectionScaffold(repoSections([], []));

    expect(html).toContain('<h2 class="repo-heading">blazetrailsdev/trails ');
    expect(html).toContain('id="repo-blazetrailsdev-trails-spawnsSection" style="display:none"');
    expect(html).toContain('id="repo-blazetrailsdev-trails-prs"');
  });

  it("escapes a repo name rather than stripping or trusting it", () => {
    const html = repoSectionScaffold([{ name: "acme/<img onerror=x>" }]);

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img onerror=x&gt;");
  });
});

describe("repoSectionsKey", () => {
  it("changes only when the repo SET does, so a refresh reuses the nodes", () => {
    const one = repoSections([{ owner: "blazetrailsdev", repo: "tasks", pr: 1 }], []);
    const two = repoSections([{ owner: "blazetrailsdev", repo: "tasks", pr: 2 }], []);
    const three = repoSections([{ owner: "blazetrailsdev", repo: "trailmap", pr: 1 }], []);

    expect(repoSectionsKey(one)).toBe(repoSectionsKey(two));
    expect(repoSectionsKey(one)).not.toBe(repoSectionsKey(three));
  });
});

describe("mainCIByRepo", () => {
  const failures = [
    { owner: "blazetrailsdev", repo: "trails", check: "typecheck", sha: "9f31ca77b1e2", time: minutesAgo(18) },
    { owner: "blazetrailsdev", repo: "trails", check: "test", sha: "9f31ca77b1e2", time: minutesAgo(18) },
    { owner: "blazetrailsdev", repo: "tasks", check: "gate", sha: "01ab77c3" },
  ];

  it("groups by repo and sorts, so trails and tasks report separately", () => {
    const groups = mainCIByRepo(failures);

    expect(groups.map((g) => g.repo)).toEqual(["tasks", "trails"]);
    expect(groups[1].items).toHaveLength(2);
  });

  it("is empty when nothing is failing", () => {
    expect(mainCIByRepo([])).toEqual([]);
    expect(mainCIByRepo(undefined)).toEqual([]);
  });

  it("lists every failing check in the hover, with a short sha and an age", () => {
    const title = mainCITitle(mainCIByRepo(failures)[1], NOW);

    expect(title).toContain("trails main CI failing:");
    expect(title).toContain("typecheck · 9f31ca7 · 18m ago");
  });

  it("omits the age when the failure carries no time", () => {
    expect(mainCITitle(mainCIByRepo(failures)[0], NOW)).toBe("tasks main CI failing:\ngate · 01ab77c");
  });
});

describe("pullFailReason", () => {
  it("names a dirty checkout, which is what most of these actually are", () => {
    expect(pullFailReason("error: cannot pull with rebase: You have unstaged changes.")).toBe(
      "local edits block pull",
    );
  });

  it("distinguishes a diverged branch, an auth problem and a conflict", () => {
    expect(pullFailReason("fatal: Not possible to fast-forward, aborting.")).toBe(
      "diverged — needs manual merge",
    );
    expect(pullFailReason("could not read Username for 'https://github.com'")).toBe("auth/network error");
    expect(pullFailReason("CONFLICT (content): Merge conflict in a.txt")).toBe("merge conflict");
  });

  it("falls back rather than guessing at an error it does not recognise", () => {
    expect(pullFailReason("something else entirely")).toBe("pull failed");
    expect(pullFailReason(undefined)).toBe("pull failed");
  });
});

describe("pullFailLabel / pullFailTitle", () => {
  const failures = [
    { owner: "blazetrailsdev", repo: "tasks", error: "error: cannot pull with rebase: unstaged changes" },
    { owner: "blazetrailsdev", repo: "trails", error: "boom" },
  ];

  it("puts the cause, not just the repo, in the pill", () => {
    expect(pullFailLabel(failures)).toBe("tasks: local edits block pull, trails: pull failed");
  });

  it("indents the raw git error under each repo in the hover", () => {
    const title = pullFailTitle([{ owner: "o", repo: "r", error: "line one\nline two" }]);

    expect(title).toBe("o/r — pull failed\n  line one\n  line two");
  });
});

describe("the queue", () => {
  const pr = { owner: "o", repo: "r", pr: 7, title: "t" };
  const queue = [
    { Owner: "o", Repo: "r", PR: 7, Message: "CI failed on o/r#7" },
    { Owner: "o", Repo: "other", PR: 7, Message: "PR has been merged" },
  ];

  it("renders under its PR row, with a button that sends that one", () => {
    const html = prRow(pr, [], NOW, null, queue);
    expect(html.match(/class="queued-row"/g)).toHaveLength(1);
    expect(html.indexOf("queued-row")).toBeGreaterThan(html.indexOf("rtitle"));
    expect(html).toContain("CI failure");
    expect(html).toContain('data-action="send-one" data-pr="7"');
    expect(prRow(pr, [], NOW, null)).not.toContain("queued-row");
  });

  it("appends only that PR's notifications to the row it is given", () => {
    expect(queuedUnder(pr, queue, "<row>").match(/^<row><div class="queued-row">.*<\/div>$/)).not.toBeNull();
    expect(queuedUnder({ ...pr, pr: 8 }, queue, "<row>")).toBe("<row>");
    expect(queuedUnder(pr, undefined, "<row>")).toBe("<row>");
  });

  it("names a held notification by what ringo's message says", () => {
    expect(["Copilot reviewed it", "has been opened", "x", undefined].map(messageKind)).toEqual([
      "copilot review", "PR opened", "notification", "notification",
    ]);
  });

  it("offers Send All only while something is queued", () => {
    expect(queueCard([])).toBe("");
    expect(queueCard(queue)).toContain("2 queued");
    expect(queueCard(queue)).toContain('data-action="drain"');
  });

  it("posts what ringo's sendOne and drainQueue post, and re-reads usage after", () => {
    const one = controlRequest("send-one", { pr: "7" });
    expect([one.path, one.body]).toEqual(["/drain-one", { pr: 7 }]);
    expect(controlOutcome(one, { ok: true, text: '{"sent":true}' }, "send")).toEqual({ disabled: true, text: "sent", refresh: "usage" });
    // A 200 that says no is a refusal: the button comes back to be tried again.
    expect(controlOutcome(one, { ok: true, text: '{"sent":false}' }, "send")).toEqual({ disabled: false, text: "fail", refresh: "usage" });
    expect(controlOutcome(one, { error: "offline" }, "send")).toEqual({ disabled: false, text: "fail" });

    const all = controlRequest("drain", {});
    expect([all.path, all.body]).toEqual(["/drain", null]);
    expect(controlOutcome(all, { ok: true, text: '{"drained":2}' }, "Send All")).toEqual({ disabled: true, refresh: "usage" });
  });
});

describe("the poke button", () => {
  const prs = [{ pane: "%1", paneStatus: "error" }, { pane: "%2", paneStatus: "working" }, { paneStatus: "error" }];
  const spawns = [{ pane: "%3", pane_status: "error" }, { pane: "%1", pane_status: "error" }];
  const reviewers = { "o/r#1": { pane_id: "%4", pane_status: "error" }, "o/r#2": { pane_id: "%5", pane_status: "idle" } };

  it("targets every red pane once, across workers, spawns and reviewers", () => {
    expect(redPanes(prs, spawns, reviewers)).toEqual(["%1", "%3", "%4"]);
    expect(redPanes(prs, undefined, null)).toEqual(["%1"]);
  });

  it("is hidden with nobody stalled, and counts them otherwise", () => {
    expect(pokeButton([])).toMatchObject({ hidden: true, panes: "" });
    expect(pokeButton(["%1"])).toEqual({ hidden: false, panes: "%1", label: "👉 poke 1 stalled agent" });
    expect(pokeButton(["%1", "%3"]).label).toBe("👉 poke 2 stalled agents");
  });

  it("posts the panes to ringo and reports how many it reached", () => {
    const request = controlRequest("poke", { panes: "%1,%3" });
    expect([request.path, request.body]).toEqual(["/poke-stalled", { panes: ["%1", "%3"] }]);
    expect(controlOutcome(request, { ok: true, text: '{"poked":["%1"]}' }, "poke")).toEqual({ disabled: true, text: "poked 1 agent", resetAfterMs: 3000 });
    expect(controlOutcome(request, { ok: false, text: "no tmux" }, "poke").text).toBe("poke failed");
    expect(controlRequest("poke", { panes: "" })).toBeNull();
  });
});

describe("draining stranded reviewers", () => {
  const stuck = (agent) => ({ agent, blocked_by_usage: true, review_owed: true });

  it("offers a drain only off an agent with a stranded review, and only onto one without", () => {
    expect(strandedAgents({ a: stuck("codex") })).toEqual({ codex: true, claude: false });
    expect(strandedAgents({ a: stuck("codex"), b: stuck("claude") })).toEqual({ codex: false, claude: false });
    expect(strandedAgents({ a: { ...stuck("claude"), review_owed: false } })).toEqual({ codex: false, claude: false });
  });

  it("asks first, posts to the agent's drain and polls its status", () => {
    const request = controlRequest("drain-reviewers", { from: "codex", status: "drainCodexStatus" });
    expect([request.path, request.body]).toEqual(["/reviewer/drain-codex", null]);
    expect(request.confirm).toBe("Kill every stranded codex reviewer pane and re-assign those PRs to Claude?");
    expect([request.statusId, request.poll]).toEqual(["drainCodexStatus", "drain-status?agent=codex"]);
    expect(controlRequest("drain-reviewers", { from: "gemini" })).toBeNull();
  });

  it("says where a drain has got to", () => {
    expect(drainStatus({ running: true, done: 1, total: 3 })).toBe("draining 1/3...");
    expect(drainStatus({ total: 0 })).toBe("nothing to drain");
    expect(drainStatus({ total: 3, drained: [1, 2], skipped: [3] })).toBe("2 moved, 1 skipped");
  });
});

describe("the relayed questions", () => {
  // Markup, and a quote that would close the attribute it is written into.
  const MARKUP = "<img src=x onerror=alert(1)>";
  const hostile = MARKUP + 'x" onclick="alert(1)';
  const second = { question: "Second?", options: [{ label: "Yes" }] };
  const ask = {
    id: hostile, label: hostile, pane: hostile, at: minutesAgo(3),
    questions: [{ header: hostile, question: hostile, options: [{ label: hostile, description: hostile }] }, second],
  };

  it("escapes every piece of model-authored text, in text and in attributes", () => {
    const html = askCards([ask], NOW);
    expect(html).not.toContain("<img");
    expect(html).not.toContain('" onclick="');
    // Eleven places: label, pane, header, question, the option's label and
    // description, the id on both buttons, and the answer's question and label.
    expect(html.split(esc(hostile)).length - 1).toBe(11);
  });

  it("renders who is asking, each question's options and a free-text answer", () => {
    const html = askCards([{ id: "a1", label: "worker", pane: "%9", at: minutesAgo(3), questions: [second] }], NOW);
    expect(html).toContain("<strong>worker</strong><code>%9</code><span>3m ago</span>");
    expect(html).toContain('data-action="answer-ask" data-id="a1" data-answer="Yes"');
    expect(html).toContain('data-action="answer-ask" data-id="a1" data-free="1"');
    expect(askSummary([ask])).toBe("1 agent blocked, waiting for an answer");
  });

  it("answers in prose: the label, under its question when there were several", () => {
    expect(askAnswer(ask, second, "Yes")).toBe("Second? → Yes");
    expect(askAnswer({ questions: [second] }, second, "Yes")).toBe("Yes");
  });

  it("posts an option or free text to ringo's relay, and nothing empty", () => {
    const request = controlRequest("answer-ask", { id: "a1", answer: "  in my own words " });
    expect([request.path, request.body]).toEqual(["/ask/answer", { id: "a1", answer: "in my own words" }]);
    expect(controlOutcome(request, { ok: true, text: "" }, "Send")).toEqual({ disabled: true, text: "sent", refresh: "asks" });
    expect(controlOutcome(request, { ok: false, text: "gone" }, "Send")).toMatchObject({ disabled: false, alert: "gone" });
    expect(controlRequest("answer-ask", { id: "a1", free: "1", answer: "  " })).toBeNull();
  });
});

describe("the usage helpers", () => {
  // Local time, as the labels are: Tuesday 8 September 2026, noon.
  const noon = new Date(2026, 8, 8, 12, 0).getTime();
  const HOUR = 3600000;
  const weeklyResetsAt = noon + 84 * HOUR;

  it("colours a bar by how full it is", () => {
    expect([0, 59, 60, 84, 85, 100].map(barColor)).toEqual(["green", "green", "yellow", "yellow", "red", "red"]);
  });

  it("colours the weekly bar by distance from pace, either side", () => {
    // 6h and 18h of a 168h week are about 3.57% and 10.71%.
    expect([0, -3.5, 3.6, 10.7, -10.8].map(weeklyPaceColor)).toEqual(["green", "green", "yellow", "yellow", "red"]);
  });

  it("reads an absolute reset as the next such time, and a duration from now", () => {
    expect(parseResetDate("Thu 3:00 PM", noon)).toEqual(new Date(2026, 8, 10, 15, 0));
    expect(parseResetDate("Tuesday 11:00 AM", noon)).toEqual(new Date(2026, 8, 15, 11, 0));
    expect(parseResetDate("Tue 12:30 AM", noon)).toEqual(new Date(2026, 8, 15, 0, 30));
    expect(parseResetDate("in 5 days, 3 hours", noon)).toEqual(new Date(noon + 123 * HOUR));
    expect(parseResetDate("2 hr 30 min", noon)).toEqual(new Date(noon + 2.5 * HOUR));
    expect(parseResetDate("in 3d 4h", noon)).toEqual(new Date(noon + 76 * HOUR));
    expect([parseResetDate("", noon), parseResetDate("soon", noon)]).toEqual([null, null]);
  });

  it("labels a reset from the epoch when there is one, and the string otherwise", () => {
    const at = new Date(2026, 8, 9, 13, 5).getTime();
    expect(formatResetLabel("Tue 6:00 PM", at, noon)).toBe("Wed 1:05 PM");
    expect(formatClockLabel("Tue 6:00 PM", at, noon)).toBe("1:05 PM");
    expect(formatResetLabel("Thu 3:00 PM", 0, noon)).toBe("Thu 3:00 PM");
    expect([formatResetLabel("soon", 0, noon), formatClockLabel("", 0, noon)]).toEqual(["soon", "?"]);
  });

  it("measures how much of the week is gone, and ticks each local midnight of it", () => {
    expect([weeklyResetsAt, noon - HOUR, 0].map((at) => weekElapsedPercent("", at, noon))).toEqual([50, 100, 0]);
    // Half gone at Tuesday noon: the week began Saturday at midnight.
    const html = dayMarkers("", weeklyResetsAt, noon);
    expect(html.match(/<span>(..)<\/span>/g).map((s) => s.slice(6, 8))).toEqual(["Su", "Mo", "Tu", "We", "Th", "Fr"]);
    expect(html).toContain('style="left:' + (24 / 168) * 100 + '%"><span>Su');
  });

  it("takes the reset from the epoch over the label, and counts the hours to it", () => {
    expect(resetDate("Thu 3:00 PM", noon + HOUR, noon)).toEqual(new Date(noon + HOUR));
    expect(resetDate("in 2h", 0, noon)).toEqual(new Date(noon + 2 * HOUR));
    expect(resetDate("", 0, noon)).toBeNull();
    expect([hoursUntilReset("in 2h", 0, noon), hoursUntilReset("", noon - HOUR, noon), hoursUntilReset("", 0, noon)]).toEqual([2, 0, null]);
  });

  it("says how far usage is from pace", () => {
    expect(paceText(50, 0)).toBe("50% of week elapsed");
    expect(paceText(50, 10)).toBe("50% of week elapsed (17h ahead)");
    expect(paceText(50, -20)).toBe("50% of week elapsed (1d 10h under)");
  });

  it("draws Claude's session, per-model and weekly bars, the pause and the extra balance", () => {
    const html = claudeUsage(
      {
        sessionPercent: 90, sessionResetsAt: new Date(2026, 8, 8, 14, 0).getTime(),
        weeklyPercent: 70, weeklyResetsAt, paused: true, queueSize: 2,
        weeklyModels: [{ name: "<b>Sonnet", percent: 140 }],
        extraLimit: 50, extraBalance: 1.5, extraSpent: 3, extraEnabled: true,
        lastCheckTime: new Date(noon - 120000).toISOString(),
      },
      noon,
    );
    expect(html).toContain("updated 2m ago");
    expect(html).toContain("Session (2:00 PM)");
    expect(html).toContain('class="bar-fill red" style="width:90%"');
    expect(html).toContain("MANUAL PAUSE (2 queued)");
    expect(html).toContain('&lt;b&gt;Sonnet</div><div class="bar-container"><div class="bar-fill red" style="width:100%"');
    expect(html).toContain('class="bar-fill red" style="width:70%"></div><div class="bar-marker" style="left:50%">');
    expect(html).toContain("50% of week elapsed (1d 10h ahead)");
    expect(html).toContain('$3.00 spent &middot; <span style="color:var(--red)">$1.50 balance</span> &middot; $50 limit');
  });

  it("drops a window Codex did not report, and says so when it reported neither", () => {
    const weekly = codexUsage({ sessionPercent: -1, weeklyPercent: 40, weeklyResetsAt, planType: "pro" }, noon);
    expect(weekly).not.toContain("Session (");
    expect(weekly).toContain('<span class="usage-meta">pro</span>');
    expect(weekly).toContain("<span>50% of week elapsed</span>");
    expect(codexUsage({ sessionPercent: 10, weeklyPercent: 40, planType: "<pro>" }, noon)).toContain("<span> &middot; &lt;pro&gt;</span>");
    expect(codexUsage({ sessionPercent: -1, weeklyPercent: -1 }, noon)).toContain("No limits reported yet");
    // A scraper with nothing yet sends no percents: zero, not "NaN%".
    expect(claudeUsage({}, noon)).not.toMatch(/NaN|undefined/);
  });
});
