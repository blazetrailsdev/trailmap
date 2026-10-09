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
  spawnRow,
  statusClass,
  timeAgo,
  visibleSpawns,
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
    expect(reviewersByKey(null)).toEqual({});
    expect(reviewersByKey([null])).toEqual({});
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
