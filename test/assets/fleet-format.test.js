import { describe, expect, it } from "vitest";
import { getFs } from "@blazetrails/ruby-compat";
import { STYLESHEET } from "../../scripts/class-collisions.ts";
import {
  CI_TITLES,
  paneOverridePill,
  plural,
  CLEAR_FAILED_ID,
  anyFailedSpawn,
  cleanupControl,
  askAnswer,
  DEFAULT_REPO,
  cleanupPending,
  control,
  BROADCAST_BUTTONS,
  broadcastButtons,
  usageScraperPill,
  controlOutcome,
  controlRequest,
  REV_EMOJI,
  WORK_EMOJI,
  activeFixers,
  agentChip,
  esc,
  fixerPhase,
  isFixerPR,
  isFixerStory,
  mainCIByRepo,
  mainCITitle,
  paneDot,
  paneHref,
  paneLine,
  reconnectDelay,
  pullFailLabel,
  pullFailReason,
  pullFailTitle,
  repoOf,
  repoSections,
  reviewerKey,
  reviewerLine,
  workerLine,
  reviewersByKey,
  reviewersPollOutcome,
  rfcSpawnRow,
  row,
  stageFigure,
  stageLabel,
  STAGES,
  STAGE_ICONS,
  ciMark,
  spawnLoopControls,
  spawnLoopView,
  statusClass,
  PILL_STATUSES,
  timeAgo,
  visibleSpawns,
  barColor,
  claudeUsage,
  codexUsage,
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
  PALETTE_INPUT,
  stageName,
  usageSummary,
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
    expect(statusClass("waiting for CI")).toBe("Label status-waiting-for-ci");
    expect(statusClass("limit reached")).toBe("Label status-limit-reached");
  });

  it("survives a missing next action rather than emitting `status-null`", () => {
    expect(statusClass(null)).toBe("Label status-");
  });

  it("has a stylesheet rule for every status it is called with, and none for any other", async () => {
    const css = await getFs().readFile(STYLESHEET, "utf8");
    const ruled = new Set([...css.matchAll(/\.(status-[a-z-]+)/g)].map((m) => m[1]).filter((c) => c !== "status-group"));
    const source = await getFs().readFile(new URL("../../app/assets/javascripts/fleet-format.js", import.meta.url), "utf8");
    // Every call site: a literal must be listed, and the one variable is
    // rfcSpawnRow's verb, whose values are checked through its output below.
    const args = [...source.matchAll(/(?<!function )(?<![.\w])statusClass\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(args).toHaveLength(3);
    for (const arg of args) {
      if (arg.startsWith('"')) expect(PILL_STATUSES).toContain(JSON.parse(arg));
      else expect(arg).toBe("verb");
    }
    for (const kind of ["rfc-refine", "rfc-sunset"]) {
      const cls = rfcSpawnRow({ kind, story_id: "0001-x" }).match(/class="Label (status-[a-z-]+)"/)[1];
      expect(PILL_STATUSES.map((s) => statusClass(s).split(" ")[1])).toContain(cls);
    }
    const emitted = PILL_STATUSES.map((s) => statusClass(s).split(" ")[1]);
    expect([...ruled].sort()).toEqual([...emitted].sort());
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

  it("draws a suggestion as a muted filled dot titled with its text", () => {
    const dot = paneDot("suggested", "run the tests");
    expect(dot).toContain("●");
    expect(dot).toContain("var(--muted)");
    expect(dot).toContain('title="suggested: run the tests"');
  });

  it("draws an unsent draft as a blue filled dot titled with its text", () => {
    const dot = paneDot("draft", "fix the typo");
    expect(dot).toContain("●");
    expect(dot).toContain("var(--accent)");
    expect(dot).toContain('title="draft: fix the typo"');
  });

  it("escapes the input text in the title attribute", () => {
    const dot = paneDot("draft", '"><script>x</script>');
    expect(dot).not.toContain("<script>");
    expect(dot).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("falls back to the idle ring when a suggested or draft pane has no text", () => {
    for (const status of ["suggested", "draft"]) {
      expect(paneDot(status)).toContain("○");
      expect(paneDot(status, "")).toContain('title="idle"');
    }
  });

  it("passes each row's input text through paneLine to the dot", () => {
    expect(paneLine("💪", "%214", "draft", "half typed")).toContain('title="draft: half typed"');
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
    const line = paneLine("📋", "%215", "idle", "", '<span class="agent-chip">claude</span>');

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

describe("reviewersPollOutcome", () => {
  const unanswered = { reviewers: null, ok: true };
  const entry = { owner: "o", repo: "r", pr: 3, agent: "claude" };
  const answered = reviewersPollOutcome({ ok: true, status: 200, body: [entry] }, unanswered);
  const pr = { owner: "o", repo: "r", pr: 3 };

  it("leaves the state unknown on a 503, and warns once with ringo's reason", () => {
    const failed = reviewersPollOutcome({ ok: false, status: 503, body: "ringo is down\n" }, unanswered);

    expect(failed).toEqual({ reviewers: null, ok: false, warn: "503 ringo is down" });
    // Unknown is not empty: no dash, because nothing said nobody is reviewing.
    expect(reviewerLine(pr, failed.reviewers)).toBe("");
  });

  it("does not warn again while the relay stays down", () => {
    const first = reviewersPollOutcome({ error: "The operation timed out." }, answered);
    const second = reviewersPollOutcome({ ok: false, status: 502, body: "" }, first);

    expect(first.warn).toBe("The operation timed out.");
    expect(second).toEqual({ reviewers: answered.reviewers, ok: false });
  });

  it("keeps the last answer through a failure", () => {
    const failed = reviewersPollOutcome({ error: "Failed to fetch" }, answered);

    expect(failed.reviewers[reviewerKey("o", "r", 3)]).toBe(entry);
  });

  it("re-arms the warning on a recovery", () => {
    const down = reviewersPollOutcome({ ok: false, status: 503, body: "" }, answered);
    const up = reviewersPollOutcome({ ok: true, status: 200, body: [entry] }, down);

    expect(up).toEqual({ reviewers: answered.reviewers, ok: true });
    expect(reviewersPollOutcome({ ok: false, status: 503, body: "" }, up).warn).toBe("503");
  });

  it("refuses a body that is not an array, by type", () => {
    const refused = reviewersPollOutcome({ ok: true, status: 200, body: {} }, unanswered);

    expect(refused).toEqual({
      reviewers: null,
      ok: false,
      warn: "the reviewer list is not an array: object",
    });
  });

  it("produces the dash from an empty list, and from nothing else", () => {
    const empty = reviewersPollOutcome({ ok: true, status: 200, body: [] }, unanswered);

    expect(empty).toEqual({ reviewers: {}, ok: true });
    expect(reviewerLine(pr, empty.reviewers)).toContain("—");
  });
});

describe("the mini-table's two labels", () => {
  it("are the emoji ringo uses, which is how a row's two lines are told apart", () => {
    expect(WORK_EMOJI).toBe("💪");
    expect(REV_EMOJI).toBe("📋");
  });
});

describe("the + buttons on a PR row", () => {
  const pr = { owner: "o", repo: "r", pr: 7, branch: "a-branch" };

  it("offers a reviewer where there is none, and a respawn where its pane has gone", () => {
    const none = reviewerLine(pr, {});
    expect(none).toContain('class="add-pane" data-action="add-reviewer" data-owner="o" data-repo="r" data-pr="7"');
    expect(none).not.toContain("data-respawn");

    const gone = reviewerLine(pr, reviewersByKey([{ owner: "o", repo: "r", pr: 7, agent: "codex" }]));
    expect(gone).toContain('data-pr="7" data-respawn="1"');
    expect(gone).toContain("agent-chip");
  });

  it("offers a worker only where there is no pane and the branch is known", () => {
    expect(workerLine(pr)).toContain('data-action="add-worker" data-owner="o" data-repo="r" data-pr="7" data-branch="a-branch"');
    expect(workerLine(pr)).toContain('class="pcell unassigned"');
    expect(workerLine({ ...pr, branch: "" })).toBe("");
    expect(workerLine({ ...pr, pane: "%4" })).not.toContain("add-worker");
  });

  it("posts what ringo's spawnReviewer and spawnWorker post", () => {
    const page = { nextReviewer: "codex" };
    const assign = controlRequest("add-reviewer", { owner: "o", repo: "r", pr: "7" }, page);
    expect([assign.path, assign.body]).toEqual([
      "/reviewer/assign",
      { owner: "o", repo: "r", pr: 7, agent: "codex", respawn: false },
    ]);
    expect(controlRequest("add-reviewer", { owner: "o", repo: "r", pr: "7", respawn: "1" }, page).body.respawn).toBe(true);

    // Before ringo has said who the next reviewer is, none is guessed.
    expect(controlRequest("add-reviewer", { owner: "o", repo: "r", pr: "7" }, {}).body.agent).toBe("");

    const spawn = controlRequest("add-worker", { owner: "o", repo: "r", pr: "7", branch: "a-branch" });
    expect([spawn.path, spawn.body]).toEqual(["/worker/spawn", { owner: "o", repo: "r", pr: 7, branch: "a-branch" }]);
  });

  it("says spawned and stays disabled, or says why on the tooltip and comes back", () => {
    const assign = controlRequest("add-reviewer", { owner: "o", repo: "r", pr: "7" }, {});
    expect(controlOutcome(assign, { ok: true, text: "" }, "+")).toEqual({ disabled: true, refresh: "reviewers", text: "spawned", title: "" });
    expect(controlOutcome(assign, { ok: false, text: "no such PR" }, "+")).toEqual({ disabled: false, refresh: "reviewers", text: "fail", title: "no such PR" });
    expect(controlOutcome(assign, { error: "offline" }, "+")).toEqual({ disabled: false, text: "err", title: "offline" });
  });
});

describe("the broadcast box", () => {
  const page = { message: "  rebase before you push  ", audiences: { all: 3, "ci-red": 1 } };

  it("labels the buttons with the live counts, and hides CI red at zero", () => {
    expect(broadcastButtons({ all: 3, "ci-red": 1 })).toEqual({
      all: { text: "all (3)", dim: false },
      ciRed: { text: "CI red (1)", hidden: false },
    });
    expect(broadcastButtons({})).toEqual({
      all: { text: "all (0)", dim: true },
      ciRed: { text: "CI red (0)", hidden: true },
    });
  });

  it("sends the trimmed message to the audience, naming its size first", () => {
    expect(controlRequest("broadcast", { target: "all" }, page)).toEqual({
      path: "/broadcast",
      body: { message: "rebase before you push", target: "all" },
      confirm: "Send to 3 agents?\n\nrebase before you push",
      note: "sending…",
      refresh: "broadcast-targets",
      holds: ["bcastAll", "bcastCIRed"],
    });
    expect(controlRequest("broadcast", { target: "ci-red" }, page).confirm).toContain("Send to 1 CI-red agent?");
  });

  it("holds both audiences' buttons while either sends", () => {
    expect(controlRequest("broadcast", { target: "ci-red" }, page).holds).toEqual(BROADCAST_BUTTONS);
  });

  it("sends nothing without a message, and says so for an audience of nobody", () => {
    expect(controlRequest("broadcast", { target: "all" }, { ...page, message: " " })).toEqual({ focus: "paletteInput" });
    expect(controlRequest("broadcast", { target: "ci-red" }, { ...page, audiences: { all: 3 } })).toEqual({
      note: "no agents in that group",
    });
  });

  it("reports what ringo delivered, keeping the message when a pane failed", () => {
    const request = controlRequest("broadcast", { target: "all" }, page);
    const sent = (out) => controlOutcome(request, { ok: true, text: JSON.stringify(out) }, "all (3)");

    const kept = { disabled: false, refresh: "broadcast-targets" };
    expect(sent({ pane_count: 3, sent: [{}, {}, {}] })).toEqual({ ...kept, note: "sent to 3 panes", clearMessage: true, closePalette: true });
    expect(sent({ pane_count: 1, skipped: 2, sent: [{ error: "gone" }] })).toEqual({
      ...kept,
      note: "sent to 1 pane (2 pane gone) — 1 failed",
    });
    expect(controlOutcome(request, { ok: false, text: "message is required" }, "all (3)").note).toBe("failed: message is required");
    expect(controlOutcome(request, { error: "offline" }, "all (3)").note).toBe("failed: offline");
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

  it("spawns the typed task in the picked repo, reporting beside the picker", () => {
    expect(controlRequest("spawn", {}, { task: "  fix the build ", repoDir: "/w/trails" })).toEqual({
      path: "/spawn",
      body: { repoDir: "/w/trails", message: "fix the build" },
      says: "spawnStatus",
      saying: "Spawning...",
      clears: "paletteInput",
    });
  });

  it("sends no spawn with no task", () => {
    expect(controlRequest("spawn", {}, { task: "   ", repoDir: "/w/trails" })).toBeNull();
  });

  it("is null for a button that is not a control", () => {
    expect(controlRequest("not-a-control", {})).toBeNull();
  });
});

describe("controlOutcome", () => {
  it("says a manual spawn landed, clears the task, gives the button back and closes the palette", () => {
    const spawn = controlRequest("spawn", {}, { task: "t", repoDir: "/w" });

    expect(controlOutcome(spawn, { ok: true, text: "spawned %5" }, "Spawn")).toEqual({
      disabled: false,
      say: "Spawned: spawned %5",
      clear: "paletteInput",
      closePalette: true,
    });
    expect(controlOutcome(spawn, { ok: false, text: "no such repo" }, "Spawn")).toEqual({ disabled: false, say: "Error: no such repo" });
    expect(controlOutcome(spawn, { error: "offline" }, "Spawn")).toEqual({ disabled: false, say: "Error: offline" });
  });

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

    expect(controlOutcome(toggle, { ok: true, text: JSON.stringify(STATE) }, "Play")).toEqual({
      disabled: false,
      state: STATE,
    });
    expect(controlOutcome(toggle, { ok: true, text: "not json" }, "Play")).toEqual({ disabled: false });
    // A refusal or a failed fetch is said, where ringo swallows both.
    const refused = (text) => ({ disabled: false, alert: "Spawn loop not changed: " + text });
    expect(controlOutcome(toggle, { ok: false, text: "bad request" }, "Play")).toEqual(refused("bad request"));
    expect(controlOutcome(toggle, { error: "offline" }, "Play")).toEqual(refused("offline"));
  });

  it("holds spawn now while the tick registers, then asks for a re-read", () => {
    const now = controlRequest("loop-now", {});

    expect(now.busy).toBe("spawning…");
    expect(controlOutcome(now, { ok: true, text: "" }, "Spawn now")).toEqual({
      disabled: true, text: "spawning…", resetAfterMs: 1500, refresh: "spawn-loop",
    });
    expect(controlOutcome(now, { error: "offline" }, "Spawn now")).toMatchObject({
      disabled: true, text: "Spawn now", alert: "Spawn now failed: offline",
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
      enabled: true, toggle: "Pause", liveCap: 6, queueCap: 12, interval: 5, bundleMode: false,
      liveNow: "(now: 4)", openNow: "(now: 9)", next: "next: A <story>", nextTitle: "a-story",
      skip: true, bundleList: "",
    });
    expect(view.lastSpawn).toMatch(/^\(last spawn at .+ \(.+\)\)$/);
    expect(spawnLoopView({}, NOW)).toMatchObject({
      enabled: false, toggle: "Play", interval: 0, liveNow: "(now: 0)", lastSpawn: "",
      next: "next: nothing ready", skip: false,
    });
  });

  it("counts down to the next spawn while running, and shows none while paused", () => {
    const at = NOW - 120000;
    const running = spawnLoopView({ enabled: true, last_spawn_at: at, next_tick_at: NOW + 7 * 60000 - 1 }, NOW);
    expect(running.lastSpawn).toMatch(/^\(last spawn at .+ \(.+\) · next spawn in 7 min\)$/);
    expect(spawnLoopView({ enabled: true, next_tick_at: NOW - 1 }, NOW).lastSpawn).toBe("(next spawn due now)");
    const paused = spawnLoopView({ enabled: false, last_spawn_at: at, next_tick_at: NOW + 60000 }, NOW);
    expect(paused.lastSpawn).toMatch(/^\(latest: [^·]+\)$/);
    expect(spawnLoopView({ enabled: true, last_spawn_at: at, next_tick_at: "" }, NOW).lastSpawn).not.toContain("next spawn");
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

describe("stageLabel", () => {
  it("names the stage in a label that carries its octicon and its colour class", () => {
    const html = stageLabel("ringo");

    expect(html).toMatch(/^<span class="Label stage st-ringo"><svg /);
    expect(html).toContain("</svg>Reviewer convergence</span>");
    expect(stageName("ci")).toBe("Getting CI green");
    expect(stageName("nope")).toBe("");
  });

  it("has an octicon for every stage", () => {
    expect(Object.keys(STAGE_ICONS)).toEqual(STAGES.map(([id]) => id));
  });
});

describe("ciMark", () => {
  it("draws a titled mark for each CI state, and none without one", () => {
    expect(ciMark("success")).toContain('class="ci ci-success" title="CI passing"');
    expect(ciMark("failure")).toContain('<span class="sr-only">check failed</span>');
    expect(ciMark("pending")).toContain('class="ci ci-pending" title="CI running"');
    expect(ciMark(undefined)).toBe("");
  });
});

describe("a pane message", () => {
  it("posts the text to the pane's own send route, not under the control prefix", () => {
    const request = controlRequest("pane-send", { pane: "%42", text: "  rebase please ", key: "s-pr-o-r-7", says: "note", clears: "box" });

    expect(request).toMatchObject({ path: "/pane/42/send", url: "/fleet/pane/42/send", body: { text: "rebase please" }, says: "note", clears: "box" });
  });

  it("sends nothing empty, and nothing to a pane id it cannot vouch for", () => {
    expect(controlRequest("pane-send", { pane: "%42", text: " " })).toBeNull();
    expect(controlRequest("pane-send", { pane: "42", text: "x" })).toBeNull();
    expect(controlRequest("pane-send", { pane: "%4/../2", text: "x" })).toBeNull();
  });

  it("logs a sent line and clears its box; shows ringo's refusal beside it", () => {
    const request = controlRequest("pane-send", { pane: "%42", text: "go", key: "k", says: "note", clears: "box" });

    expect(controlOutcome(request, { ok: true, text: "" }, "Send")).toEqual({ disabled: false, say: "sent", clear: "box", sent: { key: "k", text: "go" }, closePalette: true });
    expect(controlOutcome(request, { ok: false, text: "pane %42 has exited" }, "Send")).toEqual({ disabled: false, say: "pane %42 has exited" });
    expect(controlOutcome(request, { error: "offline" }, "Send")).toEqual({ disabled: false, say: "offline" });
  });

  it("names the palette's one input as where an empty broadcast puts the cursor", () => {
    expect(PALETTE_INPUT).toBe("paletteInput");
  });
});

describe("usageSummary", () => {
  it("is the one line a folded Usage panel shows", () => {
    expect(usageSummary({ sessionPercent: 81, weeklyPercent: 62 })).toBe("session 81% · week 62%");
    expect(usageSummary({ sessionPercent: 140, manualPause: true })).toBe("session 100% · paused");
    expect(usageSummary({})).toBe("");
    expect(usageSummary({ manualPause: true, queueSize: 3 })).toBe("paused · 3 queued");
    const now = Date.parse("2026-11-15T12:00:00Z");
    expect(usageSummary({ weeklyPercent: 5, lastCheckTime: "2026-11-15T11:58:00Z" }, now)).toBe("week 5% · updated 2m ago");
  });
});

describe("stageFigure", () => {
  it("counts open findings in review, and cycles once they are converged", () => {
    expect(stageFigure({ openFindings: 2 }, "ringo")).toBe("2 open findings");
    expect(stageFigure({ openFindings: 0, reviewCycles: 1 }, "ringo")).toBe("1 review cycle");
  });

  it("gives the CI rollup while getting CI green, and nothing it cannot measure", () => {
    expect(stageFigure({ ciStatus: "pending" }, "ci")).toBe("CI running");
    expect(stageFigure({}, "ci")).toBe("");
    expect(stageFigure({}, "drafting")).toBe("");
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

describe("repoOf", () => {
  it("joins owner and repo, tolerating a row that carries only one", () => {
    expect(repoOf({ owner: "a", repo: "b" })).toBe("a/b");
    expect(repoOf({ repo: "b" })).toBe("b");
    expect(repoOf({})).toBe("");
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

describe("the queue", () => {
  const pr = { owner: "o", repo: "r", pr: 7, title: "t" };
  const queue = [
    { Owner: "o", Repo: "r", PR: 7, Message: "CI failed on o/r#7" },
    { Owner: "o", Repo: "other", PR: 7, Message: "PR has been merged" },
  ];

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

  it("measures how much of the week is gone", () => {
    expect([weeklyResetsAt, noon - HOUR, 0].map((at) => weekElapsedPercent("", at, noon))).toEqual([50, 100, 0]);
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

  it("draws Claude's week, session and per-model rows, each a label, a meter and its percent", () => {
    const html = claudeUsage(
      {
        sessionPercent: 90, sessionResetsAt: new Date(2026, 8, 8, 14, 0).getTime(),
        weeklyPercent: 70, weeklyResetsAt,
        weeklyModels: [{ name: "<b>Sonnet", percent: 140 }],
        extraLimit: 50, extraBalance: 1.5, extraSpent: 3, extraEnabled: true,
      },
      noon,
    );
    expect(html.match(/class="usage-row"/g)).toHaveLength(3);
    expect(html).toContain('<span>Claude · week</span><span class="meter"><i class="bar-fill red" style="width:70%"></i></span><span>70%</span>');
    expect(html).toContain("50% of week elapsed (1d 10h ahead)");
    expect(html).toContain('<div class="usage-row" title="resets 2:00 PM"><span>Claude · session</span>');
    expect(html).toContain("<span>&lt;b&gt;Sonnet · week</span>");
    expect(html).toContain('style="width:100%"></i></span><span>100%</span>');
    expect(html).toContain('<div class="usage-note">Extra usage on · $3.00 spent · $1.50 balance · $50 limit</div>');
    expect(claudeUsage({ extraEnabled: false, extraLimit: 50 }, noon)).not.toContain("Extra usage");
  });

  it("drops a window Codex did not report, and says so when it reported neither", () => {
    const weekly = codexUsage({ sessionPercent: -1, weeklyPercent: 40, weeklyResetsAt }, noon);
    expect(weekly).not.toContain("Codex · session");
    expect(weekly).toContain("<span>Codex · week</span>");
    expect(weekly).toContain("50% of week elapsed");
    expect(codexUsage({ sessionPercent: 10, weeklyPercent: 40 }, noon).match(/class="usage-row"/g)).toHaveLength(2);
    expect(codexUsage({ sessionPercent: -1, weeklyPercent: -1 }, noon)).toContain("no limits reported yet");
    // The plan, which the old header printed, is in each row's tooltip, escaped.
    expect(codexUsage({ sessionPercent: 10, weeklyPercent: -1, planType: "<pro>" }, noon)).toContain(' · &lt;pro&gt; plan"><span>Codex · session</span>');
    expect(codexUsage({ sessionPercent: -1, weeklyPercent: -1, planType: "plus" }, noon)).toContain("Codex (plus) · no limits reported yet");
    expect(claudeUsage({ weeklyPercent: 5 }, noon)).not.toContain(" plan");
    // A scraper with nothing yet sends no percents: zero, not "NaN%".
    expect(claudeUsage({}, noon)).not.toMatch(/NaN|undefined/);
  });
});

describe("the usage-scraper pill", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const base = "claude.ai usage scraper (local browser watch)";

  it("is on, stale or off from the watch's connection and freshness", () => {
    expect(usageScraperPill({ watchConnected: true }, now)).toEqual({ state: "on", title: base });
    expect(usageScraperPill({ watchConnected: true, stale: true }, now).state).toBe("stale");
    expect(usageScraperPill({ watchConnected: false, stale: true }, now).state).toBe("off");
    expect(usageScraperPill({}, now).state).toBe("off");
  });

  it("names the last check and the last error in its title", () => {
    const u = { watchConnected: true, lastCheckTime: "2026-10-15T11:55:00Z", lastError: "paywall" };
    expect(usageScraperPill(u, now).title).toBe(base + " — last check 5m ago — error: paywall");
  });

  it("refreshes usage on a click, and alerts when that fails", () => {
    const request = controlRequest("refresh-usage", {});
    expect(request.path).toBe("/refresh-usage");
    expect(request.body).toBeNull();
    expect(controlOutcome(request, { ok: true, text: "{}" }, "")).toEqual({ disabled: false, refresh: "usage" });
    expect(controlOutcome(request, { ok: false, text: "not configured" }, "").alert).toBe("Usage refresh failed: not configured");
    expect(controlOutcome(request, { error: "offline" }, "").alert).toBe("Usage refresh failed: offline");
  });
});

describe("a pending pane cleanup", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  const pr = { owner: "o", repo: "r", pr: 7, pane: "%12", teardownAt: "2026-10-28T12:00:45Z" };

  it("is pending until teardownAt", () => {
    expect(cleanupPending(pr, now)).toBe(true);
  });

  it("shows nothing for Go's zero time, an absent time or a missing pane", () => {
    expect(cleanupPending({ ...pr, teardownAt: "0001-01-01T00:00:00Z" }, now)).toBe(false);
    expect(cleanupPending({ ...pr, teardownAt: undefined }, now)).toBe(false);
    expect(cleanupPending({ ...pr, pane: "" }, now)).toBe(false);
    expect(cleanupPending({ ...pr, teardownAt: "not a time" }, now)).toBe(false);
  });

  it("keeps the control for a minute past the deadline, as ringo does", () => {
    expect(cleanupPending({ ...pr, teardownAt: "2026-10-28T11:59:30Z" }, now)).toBe(true);
    expect(cleanupPending({ ...pr, teardownAt: "2026-10-28T11:59:00Z" }, now)).toBe(false);
  });

  it("posts the pane to /cancel-cleanup and reports kept or too late", () => {
    const request = controlRequest("cancel-cleanup", { pane: "%12" });
    expect(request.path).toBe("/cancel-cleanup");
    expect(request.body).toEqual({ pane: "%12" });
    expect(controlOutcome(request, { ok: true, text: "" }, "cancel cleanup").text).toBe("kept");
    const late = controlOutcome(request, { ok: false, text: "no cleanup pending" }, "cancel cleanup");
    expect(late.text).toBe("too late");
    expect(late.title).toBe("no cleanup pending");
    expect(controlOutcome(request, { error: "offline" }, "cancel cleanup").text).toBe("err");
  });
});

describe("the helpers the session list shares", () => {
  it("pluralises a count", () => {
    expect(plural(1, "cycle")).toBe("1 cycle");
    expect(plural(2, "cycle")).toBe("2 cycles");
  });

  it("names each CI state in words", () => {
    expect(CI_TITLES).toEqual({ success: "CI passing", failure: "CI failing", pending: "CI running" });
  });

  it("overrides the row with a pane at its limit or waiting, and nothing else", () => {
    expect(paneOverridePill("limit")).toContain("limit reached");
    expect(paneOverridePill("waiting")).toContain("waiting for answer");
    expect(paneOverridePill("working")).toBeNull();
  });
});
