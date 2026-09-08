import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPO,
  activeFixers,
  esc,
  fixerCards,
  fixerPhase,
  fixerSummary,
  isFixerPR,
  isFixerStory,
  mainCIByRepo,
  mainCITitle,
  paneDot,
  paneLine,
  prRow,
  pullFailLabel,
  pullFailReason,
  pullFailTitle,
  repoOf,
  repoSections,
  rfcSpawnRow,
  row,
  sectionId,
  spawnRow,
  statusClass,
  timeAgo,
  visibleSpawns,
} from "../../app/assets/javascripts/fleet-format.js";

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

describe("paneLine", () => {
  it("renders the pane id and its dot", () => {
    const line = paneLine("💪", "%214", "working");

    expect(line).toContain("<code>%214</code>");
    expect(line).toContain("working");
  });

  it("renders nothing at all when there is no pane", () => {
    expect(paneLine("💪", "", "working")).toBe("");
    expect(paneLine("💪", undefined, undefined)).toBe("");
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
