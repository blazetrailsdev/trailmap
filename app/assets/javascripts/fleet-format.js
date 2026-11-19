/*
 * The fleet dashboard's pure half: everything that turns one frame of ringo's
 * SSE envelope into HTML, with no `document` in sight.
 *
 * Split out of `dashboard.js` so it can be tested. The DOM wiring there is a
 * handful of `innerHTML =` assignments; ALL of the logic worth getting right --
 * which phase a red repo is in, which spawn a PR row supersedes, what a git
 * error actually means, how repos order -- lives here and is exercised directly
 * by `test/assets/fleet-format.test.js`.
 *
 * Ported from the render functions inside ringo's constant dashboard HTML
 * (`webhook/dashboard.go:515-2306`).
 */

/** Escape into text/attribute context -- the envelope is not ours to trust. */
export function esc(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/** `now` is injectable so a test does not have to race the clock. */
export function timeAgo(ts, now = Date.now()) {
  const s = Math.floor((now - new Date(ts).getTime()) / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

/** Every phrase `statusClass` is called with; each has a `.status-*` rule. */
export const PILL_STATUSES = ["limit reached", "waiting for answer", "refining", "sunsetting"];

export function statusClass(next) {
  return "Label status-" + String(next || "").toLowerCase().replace(/\s+/g, "-");
}

/*
 * The pane status dot: green working, yellow waiting on an answer, red API
 * error, purple half-circle out of quota, muted ring idle. An idle pane with
 * text in its input box is `suggested` (Claude Code's own dimmed suggestion, a
 * muted filled dot) or `draft` (typed by the operator and not sent, blue), and
 * the dot's title carries that text, as ringo's `paneDot` does. The limit dot is its own GLYPH
 * as well as its own colour -- an exhausted agent looks idle in every other
 * way, and a dot that differed only by hue would be missed in a column of
 * them. Colours are the shell's tokens, not ringo's literal hexes.
 */
const PANE_DOTS = {
  working: ["var(--green)", "●", "working"],
  waiting: ["var(--yellow)", "●", "waiting for an answer"],
  error: ["var(--red)", "●", "API error (5xx / stuck retry)"],
  limit: ["var(--purple)", "◑", "hit its session/usage limit — stopped until the quota resets"],
};

const INPUT_DOTS = {
  suggested: ["var(--muted)", "●"],
  draft: ["var(--accent)", "●"],
};

export function paneDot(status, input = "") {
  if (INPUT_DOTS[status] && input) {
    const [color, glyph] = INPUT_DOTS[status];
    return ' <span style="color:' + color + '" title="' + esc(status + ": " + input) + '">' + glyph + "</span>";
  }
  const [color, glyph, title] = PANE_DOTS[status] || ["var(--muted)", "○", "idle"];
  return ' <span style="color:' + color + '" title="' + title + '">' + glyph + "</span>";
}

export const WORK_EMOJI = "💪";

/**
 * The live view of a pane, `/panes/42` for `%42`; '' for anything that is not
 * a tmux pane id, which then renders as plain text rather than a dead link.
 *
 * The digits are the grammar `isPaneId` in `config/fleet.ts` checks on the
 * server, which this file cannot import; `test/assets/fleet-format.test.js`
 * holds the two to the same answer.
 */
export function paneHref(pane) {
  const match = /^%([0-9]{1,10})$/.exec(String(pane == null ? "" : pane));
  return match ? "/panes/" + match[1] : "";
}

/**
 * One row of the compact pane mini-table; '' when there is no pane. Every row
 * type's pane id comes through here, so this is where it becomes a link.
 *
 * `lead` is markup that sits just before the id, which is where the reviewer
 * row puts its agent chip -- as ringo's `paneLine` puts the agent's logo
 * (`dashboard.go:575`).
 */
export function paneLine(label, pane, status, input = "", lead = "") {
  if (!pane) return "";
  const role = label === WORK_EMOJI ? "worker" : "reviewer";
  const href = paneHref(pane);
  const id = "<code>" + esc(pane) + "</code>";
  return (
    '<div class="pcell"><span class="plabel" title="' + role + '">' + label + "</span>" +
    '<span class="pval">' + lead +
    (href ? '<a class="pane-link" href="' + href + '" title="watch this pane live">' + id + "</a>" : id) +
    paneDot(status, input) + "</span></div>"
  );
}

export const REV_EMOJI = "📋";

/**
 * The reviewer's agent, as a chip just before its pane id. ringo draws the
 * company logo here; trailmap carries no logo assets, and the agent's NAME
 * says the same thing in the same space.
 *
 * `blocked` is ringo's `blocked_by_usage`: the pane is sitting on its limit
 * banner and owes a review it cannot write until the quota resets. That is
 * about the agent, not about the pane's momentary state, so it marks the chip
 * rather than the dot.
 */
export function agentChip(agent, blocked) {
  if (!agent) return "";
  const title = blocked ? agent + " is blocked by its usage limit" : agent;
  return (
    '<span class="agent-chip' + (blocked ? " blocked" : "") + '" title="' + esc(title) + '">' +
    esc(agent) + "</span>"
  );
}

/** How ringo keys its reviewer list: `owner/repo#pr`. */
export const reviewerKey = (owner, repo, pr) => owner + "/" + repo + "#" + pr;

/**
 * ringo's `/reviewer/list` array, as the map the rows look a PR up in.
 *
 * An array is the only usable answer, and anything else is refused by name:
 * the page's choice is between "nobody is reviewing this" and "I do not know",
 * and it can only make it if a malformed body is told apart from an empty
 * list. A hole INSIDE the list is skipped -- one unusable entry is not a
 * reason to lose the other hundred.
 */
export function reviewersByKey(list) {
  if (!Array.isArray(list)) {
    throw new TypeError("the reviewer list is not an array: " + (list === null ? "null" : typeof list));
  }
  const map = {};
  for (const entry of list) {
    if (entry) map[reviewerKey(entry.owner, entry.repo, entry.pr)] = entry;
  }
  return map;
}

/**
 * What a settled reviewer poll does to the page's state. `result` is
 * `{ ok, status, body }` for an answered request -- `body` the parsed JSON of
 * a 2xx, the text of anything else -- and `{ error }` for one that never got
 * an answer, a timeout included. `previous` is the last outcome, starting
 * from `{ reviewers: null, ok: true }`.
 *
 * Returns `{ reviewers, ok, warn? }`:
 *
 * - `reviewers` is replaced only by an ARRAY. Every failure keeps the last
 *   answer, which before the first success is `null`: unanswered, and
 *   `reviewerLine` draws nothing for it. An answered-but-empty list is `{}`,
 *   the only thing that produces the "nobody is reviewing this" dash.
 * - `warn` is the reason, present on the poll that FAILED AFTER A SUCCESS and
 *   on no other, so a relay that stays down is reported once rather than every
 *   thirty seconds, and a recovery re-arms it.
 */
export function reviewersPollOutcome(result, previous) {
  let reason;
  if ("error" in result) {
    reason = result.error;
  } else if (!result.ok) {
    reason = (result.status + " " + String(result.body ?? "")).trim();
  } else {
    // `reviewersByKey` refuses a body that is not an array, by name, so a
    // ringo answering `{}` is reported as what it was.
    try {
      return { reviewers: reviewersByKey(result.body), ok: true };
    } catch (error) {
      reason = error.message;
    }
  }
  const outcome = { reviewers: previous.reviewers, ok: false };
  if (previous.ok) outcome.warn = reason;
  return outcome;
}

/**
 * The reviewer row of a PR's pane mini-table, right below the worker's.
 *
 * Three states, all of them worth a row: a reviewer with a live pane (agent,
 * pane id, status dot -- the same shape as the worker's line, linked to the
 * same live view), a reviewer pinned to a PR whose pane has gone (the agent
 * and a dash, because the assignment outlives the pane), and no reviewer at
 * all (a dash). The last two offer ringo's `+`, which spawns a reviewer -- as
 * the loop's CURRENT reviewer, not the old pin, when it is a respawn.
 *
 * And a fourth state that is NOT one of them: no answer yet. `reviewers` is
 * null before the first poll lands and while every poll is failing, and then
 * this renders NOTHING. The dash is a claim -- it says nobody is reviewing
 * this PR -- and making that claim out of an unconfigured RINGO_BASE or an
 * unreachable ringo would be stating as fact the one thing the page most
 * wants to be trusted on. Silence is the honest answer to "I do not know".
 */
export function reviewerLine(pr, reviewers = null) {
  if (!reviewers) return "";
  const entry = reviewers[reviewerKey(pr.owner, pr.repo, pr.pr)];
  const chip = entry ? agentChip(entry.agent, entry.blocked_by_usage) : "";
  if (entry && entry.pane_id) return paneLine(REV_EMOJI, entry.pane_id, entry.pane_status, entry.pane_input, chip);
  const args = { owner: pr.owner, repo: pr.repo, pr: pr.pr, ...(entry ? { respawn: "1" } : {}) };
  const title = entry ? "Respawn the reviewer for this PR" : "Spawn a reviewer for this PR";
  return unassignedLine(REV_EMOJI, "reviewer", chip, control("add-reviewer", args, { cls: "add-pane", title, label: "+" }));
}

/**
 * The worker row. With no pane it offers a `+` that re-attaches a worker to
 * the PR's existing worktree -- only when the branch is known, because the
 * worktree is resolved from it (`workerLine`, `dashboard.go:849`).
 */
export function workerLine(pr) {
  if (pr.pane) return paneLine(WORK_EMOJI, pr.pane, pr.paneStatus, pr.paneInput);
  if (!pr.branch) return "";
  const args = { owner: pr.owner, repo: pr.repo, pr: pr.pr, branch: pr.branch };
  const title = "Re-attach a worker to this PR's worktree";
  return unassignedLine(WORK_EMOJI, "worker", "", control("add-worker", args, { cls: "add-pane", title, label: "+" }));
}

/** A pane row with no pane in it: a dash, and the button that would fill it. */
function unassignedLine(label, role, lead, button) {
  return (
    '<div class="pcell unassigned"><span class="plabel" title="' + role + '">' + label + "</span>" +
    '<span class="pval">' + lead + '<span class="dash">—</span>' + button + "</span></div>"
  );
}

/** Whether the in-flight CI fixer is the worker on this story / this PR. */
export const isFixerStory = (fixers, id) => !!id && (fixers || []).some((f) => f.story_id === id);
export const isFixerPR = (fixers, pr) =>
  (fixers || []).some((f) => f.pr && f.pr === pr.pr && f.owner === pr.owner && f.repo === pr.repo);

// ---------------------------------------------------------------------------
// CI fixer
// ---------------------------------------------------------------------------

/**
 * The fixers worth a card. A repo with a fixer story, a paused loop, a
 * recovering main or any consecutive reds is in one of the four phases; a repo
 * reported with none of those is green and gets no card.
 */
export const activeFixers = (fixers) =>
  (fixers || []).filter((f) => f.story_id || f.paused || f.recovering || (f.consecutive_red || 0) > 0);

/**
 * `paused` beats `fixing`: it means the spawn loop has STOPPED because main is
 * red, which is the more urgent fact even once a fixer is on it. `recovering`
 * beats both -- main is green again and the card is on its way out.
 */
export function fixerPhase(f) {
  if (f.recovering) return "recovering";
  if (f.paused) return "paused";
  if (f.story_id) return "fixing";
  return "red";
}

// ---------------------------------------------------------------------------
// The stream
// ---------------------------------------------------------------------------

/**
 * How long to wait before reconnect number `attempt`: nothing for the first,
 * since a dropped socket is usually a deploy that is already back, then one
 * second doubling to a ceiling of thirty.
 */
export function reconnectDelay(attempt) {
  if (attempt <= 0) return 0;
  return Math.min(30000, 1000 * 2 ** (attempt - 1));
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/*
 * The page's write controls. Every one of them is a POST into ringo, which
 * owns the state it changes (tmux panes, the spawn loop, the merge gate);
 * trailmap draws the button and addresses the request.
 *
 * A button carries its action and arguments as `data-` attributes and the page
 * has ONE click listener. ringo writes `onclick="mergePR('owner','repo',7,this)"`
 * into the markup, which needs its functions to be globals and its arguments
 * to survive being quoted into JavaScript inside HTML; a module has no globals,
 * and `esc` already makes an attribute value safe.
 */

/** The button whose click `controlRequest` turns into a request. */
export function control(action, args, { cls, title, label, id, hidden }) {
  const data = Object.entries(args)
    .map(([key, value]) => " data-" + key + '="' + esc(value) + '"')
    .join("");
  return (
    "<button" + (id ? ' id="' + id + '"' : "") +
    ' class="' + cls + '" data-action="' + action + '"' + data +
    (hidden ? ' style="display:none"' : "") +
    ' title="' + esc(title) + '">' + label + "</button>"
  );
}

/** The global "clear failed" button, shown only while a spawn has failed. */
export const CLEAR_FAILED_ID = "clearFailedBtn";

/** It clears every failed row, so it answers to every section's spawns. */
export const anyFailedSpawn = (spawns) => spawns.some((s) => s.status === "failed");

/**
 * What a control does: where it posts in ringo, what it sends, what it asks
 * first, and what its button says while and after. `null` for a button that is
 * not a control, or one with nothing to send. Ported from the functions of
 * `webhook/dashboard.go` whose requests these are: `mergePR`, `dismissSpawn`,
 * `clearFailedSpawns`, `respawnFixer`, and the ones named at their cases.
 *
 * `quiet` is ringo's distinction between the two families: dismissing just
 * disables the button and lets the next frame remove the row, while merge and
 * respawn report on the button itself and in an alert, because the row stays.
 */
export function controlRequest(action, data, page = {}) {
  const repo = data.owner + "/" + data.repo;
  // ringo's `+` buttons report on themselves and stay usable after a refusal.
  const plus = { busy: "...", done: "spawned", failed: "fail", errored: "err", titled: true };
  switch (action) {
    case "add-reviewer":
      return {
        ...plus,
        path: "/reviewer/assign",
        // With no agent known yet, ringo picks the loop's own for a respawn and
        // refuses anything else by name (`handler.go:1053`), which the `+` shows.
        body: { owner: data.owner, repo: data.repo, pr: Number(data.pr), agent: page.nextReviewer || "", respawn: !!data.respawn },
        // The list is polled, not streamed, so the new reviewer is fetched.
        refresh: "reviewers",
      };
    case "add-worker":
      return {
        ...plus,
        path: "/worker/spawn",
        body: { owner: data.owner, repo: data.repo, pr: Number(data.pr), branch: data.branch },
      };
    case "broadcast": {
      const message = (page.message || "").trim();
      // ringo puts the cursor in the box: that is what says why nothing went.
      if (!message) return { focus: BROADCAST_MESSAGE };
      const count = (page.audiences || {})[data.target] || 0;
      // `note` is where a broadcast reports: on the box, not on its button.
      if (!count) return { note: "no agents in that group" };
      const who = (data.target === "all" ? "agent" : "CI-red agent") + (count === 1 ? "" : "s");
      return {
        path: "/broadcast",
        body: { message, target: data.target },
        // It types into someone else's session, so it names the audience first.
        confirm: "Send to " + count + " " + who + "?\n\n" + message,
        note: "sending…",
        refresh: "broadcast-targets",
        // Both audiences' buttons are held, so a second one cannot be sent
        // the same sentence mid-flight (`sendBroadcast`, `dashboard.go:2117`).
        holds: BROADCAST_BUTTONS,
      };
    }
    // `refreshUsageNow`: the scraper pill's click. ringo answers with the
    // fresh status, which the re-read draws.
    case "refresh-usage":
      return { path: "/refresh-usage", body: null, keep: true, refresh: "usage", errorAlert: (message) => "Usage refresh failed: " + message, failureAlert: (text) => "Usage refresh failed: " + text };
    case "merge": {
      const pr = Number(data.pr);
      return {
        path: "/merge-pr",
        body: { owner: data.owner, repo: data.repo, pr },
        confirm: "Merge " + repo + "#" + pr + "?",
        busy: "...",
        done: "merged",
        failed: "fail",
        errored: "err",
        // ringo puts the server's answer on the merge button's tooltip.
        titled: true,
        // The button comes back, but not for five seconds, whatever happened.
        resetAfterMs: 5000,
        failureAlert: (text) => "Merge blocked for " + repo + "#" + pr + ":\n\n" + text,
        errorAlert: (message) => "Merge error for " + repo + "#" + pr + ":\n\n" + message,
      };
    }
    case "respawn-fixer":
      return {
        path: "/ci-fixer/spawn",
        body: { owner: data.owner, repo: data.repo },
        confirm: "Discard the tracked fixer story and spawn a fresh fixer for " + repo + "?",
        busy: "spawning…",
        done: "spawned",
        failureAlert: (text) => "Respawn failed: " + text,
        errorAlert: (message) => "Respawn failed: " + message,
      };
    // The loop's panel. Three of the four answer with the loop's new state
    // (`state`), which the page draws; ringo's `toggleSpawnLoop`,
    // `setSpawnLoopCap`, `skipNext` and `spawnLoopNow`.
    case "loop-toggle":
      return { path: "/spawnloop/config", body: { enabled: data.enabled !== "true" }, state: true };
    case "loop-settings": {
      const minutes = parseInt(data.interval, 10);
      return {
        path: "/spawnloop/config",
        // A blank or zero field is left out, so ringo keeps what it has.
        body: {
          live_cap: parseInt(data.liveCap, 10) || undefined,
          queue_cap: parseInt(data.queueCap, 10) || undefined,
          stagger_seconds: minutes > 0 ? minutes * 60 : undefined,
          bundle_mode: !!data.bundle,
        },
        state: true,
      };
    }
    case "loop-skip":
      return { path: "/spawnloop/skip", body: null, state: true };
    case "loop-now":
      return {
        path: "/spawnloop/spawn-now", body: null, busy: "spawning…", done: "spawning…",
        // A tick takes a moment to register: hold the button, and re-read.
        resetAfterMs: 1500,
        refresh: "spawn-loop",
        failureAlert: (text) => "Spawn now failed: " + text,
        errorAlert: (message) => "Spawn now failed: " + message,
      };
    case "dismiss":
      return { path: "/spawnloop/dismiss", body: { branch: data.branch }, quiet: true };
    // `sendOne` (`dashboard.go:1902`). ringo answers 200 either way and says
    // which in the body, so `accepted` is what makes it a success. ringo leaves
    // the button dead on "fail"; here a refusal gives it back.
    case "send-one": {
      const accepted = (text) => !!parsed(text).sent;
      return { path: "/drain-one", body: { pr: Number(data.pr) }, busy: "...", accepted, done: "sent", failed: "fail", errored: "fail", refresh: "usage" };
    }
    case "drain":
      return { path: "/drain", body: null, quiet: true, refresh: "usage" };
    // `cancelCleanup` (`dashboard.go:2056`): 204 kept the pane, 409 means the
    // quit already went out or nothing was pending. The row repaints on the
    // next frame, which carries the cleared `teardownAt`.
    case "cancel-cleanup":
      return { path: "/cancel-cleanup", body: { pane: data.pane }, busy: "...", done: "kept", failed: "too late", errored: "err", titled: true };
    case "poke": {
      const panes = String(data.panes || "").split(",").filter(Boolean);
      if (!panes.length) return null;
      const report = (text) => "poked " + plural((parsed(text).poked || []).length, "agent");
      // The result lingers three seconds, then the next frame recounts.
      return { path: "/poke-stalled", body: { panes }, busy: "poking…", report, failed: "poke failed", errored: "poke failed", resetAfterMs: 3000 };
    }
    // `drainReviewers`. ringo answers 202 at once and drains in the background,
    // so the click only starts it: `statusId` names where `drainStatus` goes
    // and `poll` the read that reports progress.
    case "drain-reviewers": {
      const to = { codex: "Claude", claude: "Codex" }[data.from];
      if (!to) return null;
      const confirm = "Kill every stranded " + data.from + " reviewer pane and re-assign those PRs to " + to + "?";
      return { path: "/reviewer/drain-" + data.from, body: null, confirm, statusId: data.status, poll: "drain-status?agent=" + data.from };
    }
    // `answerAsk` and `answerAskFree`: both send prose, and nothing empty.
    case "answer-ask": {
      const answer = String(data.answer || "").trim();
      if (!answer) return null;
      const errorAlert = (message) => "Failed to send answer: " + message;
      return { path: "/ask/answer", body: { id: data.id, answer }, done: "sent", refresh: "asks", failureAlert: (text) => text, errorAlert };
    }
    // A line typed into a session's pane, from its card's message box, a
    // stall's prod or the palette: `POST fleet/pane/:id/send`, which is not
    // under the control prefix, so it names its own `url`.
    case "pane-send": {
      const id = /^%([0-9]{1,10})$/.exec(String(data.pane || ""));
      const text = String(data.text || "").trim();
      if (!id || !text) return null;
      return {
        path: "/pane/" + id[1] + "/send",
        url: "/fleet/pane/" + id[1] + "/send",
        body: { text },
        pane: true,
        key: data.key || "",
        says: data.says,
        // The button itself says it is sending; the status region beside it
        // carries the same words for a screen reader, visually hidden.
        busy: "Sending…",
        saying: "Sending message",
        clears: data.clears || "",
      };
    }
    // End a session's pane: `/exit` to quit Claude, then, once it has gone,
    // `exit` to close the fish shell it ran in.
    case "pane-end": {
      const id = /^%([0-9]{1,10})$/.exec(String(data.pane || ""));
      if (!id) return null;
      return {
        path: "/pane/" + id[1] + "/send",
        url: "/fleet/pane/" + id[1] + "/send",
        body: { text: "/exit" },
        then: { text: "exit", screen: "/fleet/pane/" + id[1] + "/screen", everyMs: 500, timeoutMs: 20000 },
        confirm: "End pane " + data.pane + "? This exits Claude and closes its shell.",
        pane: true,
        key: data.key || "",
        says: data.says,
        saying: "ending…",
      };
    }
    case "clear-failed":
      return { path: "/spawnloop/dismiss-failed", body: null, quiet: true };
    // The spawn dialog. It posts where ringo's own dashboard does, so a manual
    // spawn gets the loop's start script, worktree root and model; `model` and
    // `name` are sent only when the viewer chose one, so an empty one is the
    // loop's. Its report goes beside the dialog's button (`says`), and a spawn
    // that landed empties the task.
    case "spawn": {
      const message = String(page.task || "").trim();
      if (!message) return { focus: SPAWN_TASK, says: "spawnStatus", hint: "Describe the task first." };
      const model = String(page.model || "").trim();
      const name = String(page.name || "").trim();
      return {
        path: "/spawnloop/dashboard-spawn",
        body: { repoDir: page.repoDir || "", message, ...(model ? { model } : {}), ...(name ? { name } : {}) },
        says: "spawnStatus",
        saying: "Spawning...",
        clears: SPAWN_TASK,
      };
    }
    default:
      return null;
  }
}

/** A JSON answer, or `{}` for one that is not: ringo's errors are plain text. */
function parsed(text) {
  try { return JSON.parse(text) || {}; } catch { return {}; }
}

export const plural = (n, noun) => n + " " + noun + (n === 1 ? "" : "s");

/**
 * Whether a pane's screen (the `/fleet/pane/:id/screen` body) shows Claude
 * gone: the pane itself gone, or no Claude UI left and a shell prompt on the
 * last line. End pane types the shell's `exit` only once this holds, so it is
 * never typed into Claude as a prompt.
 *
 * `toText` turns the screen's HTML into its text; the page passes the
 * browser's own parser. ringo reports no pane command, so this reads the
 * screen: a prompt is a last line ending in `>`, `$`, `#`, `%` (zsh) or `❯`,
 * and any of Claude Code's own UI strings in the last four non-blank lines
 * means not yet.
 */
export function claudeHasExited(body, toText) {
  if (!body || typeof body !== "object") return false;
  if (body.exists === false) return true;
  if (typeof body.html !== "string") return false;
  // Only the bottom of the screen: Claude's UI sits there while it runs, and
  // scrollback above a shell prompt may quote the same strings.
  const tail = toText(body.html).split("\n").map((line) => line.trimEnd()).filter(Boolean).slice(-SCREEN_TAIL);
  if (tail.some((line) => CLAUDE_UI.test(line))) return false;
  return /[>$#%❯]$/.test(tail.at(-1) || "");
}

/**
 * The message Claude Code suggests in its input box: dim text straight after
 * the `>` (or `❯`) of the prompt line near the bottom of the screen, as ringo
 * renders it (`opacity:.65` on a span, `paneterm.go`). An empty box's own
 * placeholder, `Try "…"`, is not a suggestion. Null when there is none, or
 * when anything the operator typed (undimmed) sits in the box.
 */
export function suggestedMessage(html) {
  if (typeof html !== "string" || !html) return null;
  const lines = html.split("\n").filter((line) => line.replace(/<[^>]*>/g, "").trim()).slice(-SUGGEST_TAIL);
  for (let i = lines.length - 1; i >= 0; i--) {
    const parts = [];
    for (const m of lines[i].matchAll(/<span style="([^"]*)">([^<]*)<\/span>|([^<]+)/g)) {
      parts.push({ dim: m[1] !== undefined && /opacity/.test(m[1]), text: decodeEntities(m[2] ?? m[3]) });
    }
    const plain = parts.map((p) => p.text).join("");
    const prompt = /^[\s│]*[>❯][\s\u00a0]/.exec(plain);
    if (!prompt) continue;
    let at = 0;
    let dim = "";
    for (const part of parts) {
      const start = Math.max(prompt[0].length - at, 0);
      const rest = part.text.slice(start).replace(/[\s\u00a0]*│[\s\u00a0]*$/, "");
      at += part.text.length;
      if (!rest.trim()) continue;
      if (!part.dim) return null;
      dim += rest;
    }
    const text = dim.replace(/\u00a0/g, " ").trim();
    return text && !/^Try "/.test(text) ? text : null;
  }
  return null;
}

const SUGGEST_TAIL = 8;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#34": '"', nbsp: "\u00a0" };
const decodeEntities = (text) => text.replace(/&(amp|lt|gt|quot|nbsp|#39|#34);/g, (_, name) => ENTITIES[name]);

const CLAUDE_UI = /for shortcuts|esc to interrupt|auto mode|accept edits|bypass permissions|╭─|^\s*│ >/;
const SCREEN_TAIL = 4;

/**
 * What the button shows once its request has settled. `result` is
 * `{ ok, text }` for an answered request and `{ error }` for one that never
 * got an answer; `label` is what the button said before the click.
 *
 * Returns `{ disabled, text?, title?, alert?, resetAfterMs?, refresh? }`. A
 * missing `text` leaves the button's text alone; `refresh` names the read to
 * poll again, because an answered control changed what it reports.
 *
 * Five families: ringo's four, with two of its holes closed, and manual spawn:
 *
 * - merge keeps the button disabled for the full reset period on EVERY
 *   outcome, a failed fetch included, then restores it.
 * - respawn stays disabled on success (the card redraws) and comes straight
 *   back on any failure.
 * - the quiet controls stay disabled on success, because the next frame
 *   removes the row or hides the button. On a refusal or a failed fetch they
 *   come back. ringo leaves them disabled there, and since the row only goes
 *   away on success, that is a dead button with nothing to say why.
 * - manual spawn comes back at once, and reports beside itself (`say`)
 *   rather than on its button; a spawn that landed clears the task box.
 * - a pane message that landed closes the palette (`closePalette`), and a
 *   complete broadcast its dialog (`closeBroadcast`); a failure keeps either
 *   open with its error.
 * - the loop's settings never stay disabled: the control is still there after
 *   the click, and a success carries the loop's new `state` for the page to
 *   draw. A refusal or a failed fetch alerts, where ringo says nothing.
 *   "Spawn now" is the exception, held like merge and then re-read
 *   (`refresh`), because ringo answers before the tick has registered.
 */
export function controlOutcome(request, result, label) {
  const answered = !("error" in result);
  // A 200 is not always a yes: `accepted` reads the body of one that says no.
  const succeeded = answered && result.ok && (!request.accepted || request.accepted(result.text));
  const outcome = { disabled: succeeded || (!request.quiet && !!request.resetAfterMs) };
  if (answered && request.refresh) outcome.refresh = request.refresh;
  if (request.quiet) return outcome;
  // A pane message reports beside its box, and a sent one goes in the log.
  if (request.pane) {
    const text = request.busy ? label : undefined;
    if (!succeeded) return { disabled: false, text, say: answered ? result.text : result.error };
    return { disabled: false, text, say: "sent", clear: request.clears || undefined, sent: { key: request.key, text: request.body.text }, closePalette: true };
  }
  if (request.says) {
    if (!succeeded) return { disabled: false, say: "Error: " + (answered ? result.text : result.error) };
    return { disabled: false, say: "Spawned: " + result.text, clear: request.clears, closeSpawn: true };
  }
  // A control that stays where it is: it comes back, and says nothing on itself.
  if (request.keep) {
    const alert = answered ? request.failureAlert : request.errorAlert;
    return { ...outcome, disabled: false, ...(!succeeded && alert ? { alert: alert(answered ? result.text : result.error) } : {}) };
  }
  if (request.state) {
    if (succeeded) return stateOutcome(result.text);
    return { disabled: false, alert: "Spawn loop not changed: " + (answered ? result.text : result.error) };
  }

  const said = answered ? result.text : result.error;
  if (request.note) {
    // The buttons come back either way; the message is kept unless it landed.
    const sent = succeeded ? broadcastSent(said) : null;
    return {
      ...outcome,
      disabled: false,
      note: sent ? sent.note : "failed: " + said,
      ...(sent && sent.complete ? { clearMessage: true, closeBroadcast: true } : {}),
    };
  }
  if (succeeded) outcome.text = request.report ? request.report(result.text) : request.done;
  else if (answered) outcome.text = request.failed || label;
  else outcome.text = request.errored || label;
  if (request.titled) outcome.title = said;
  const alert = answered ? request.failureAlert : request.errorAlert;
  if (!succeeded && alert) outcome.alert = alert(said);
  if (request.resetAfterMs) outcome.resetAfterMs = request.resetAfterMs;
  return outcome;
}

/** A setting's outcome: never held, and carrying ringo's new loop state when the body is one. */
function stateOutcome(text) {
  try {
    const state = JSON.parse(text);
    if (state && typeof state === "object") return { disabled: false, state };
  } catch {
    // Not JSON: the control comes back and the panel keeps what it showed.
  }
  return { disabled: false };
}

// The spawn loop's settings panel.

/** The panel's buttons, drawn once; `spawnLoopView` says what each shows. */
export const spawnLoopControls = () =>
  control("loop-toggle", { enabled: "false" }, {
    id: "slToggle", cls: "btn btn-green btn-sm", title: "Start or pause the spawn loop", label: "Play",
  }) +
  control("loop-now", {}, {
    cls: "btn btn-blue btn-sm", title: "Run one tick now, bypassing caps", label: "Spawn now",
  }) +
  '<span class="field-note" id="slNext"></span>' +
  control("loop-skip", {}, {
    id: "slSkip", cls: "btn btn-sm", title: "Skip the next story", label: "Skip", hidden: true,
  });

/**
 * "last spawn at 10:42 (2m ago) · next spawn in 7 min" while the loop runs;
 * only "latest: 2m ago" while it is paused, since a paused loop spawns
 * nothing. ringo's `next_tick_at` is the last tick plus the stagger, so a
 * stagger change counts from that tick rather than restarting the clock.
 */
function spawnTiming(s, now) {
  const parts = [];
  if (s.last_spawn_at) {
    parts.push(s.enabled
      ? "last spawn at " + new Date(s.last_spawn_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) +
        " (" + timeAgo(s.last_spawn_at, now) + ")"
      : "latest: " + timeAgo(s.last_spawn_at, now));
  }
  if (s.enabled && s.next_tick_at) {
    const mins = Math.ceil((new Date(s.next_tick_at).getTime() - now) / 60000);
    parts.push(mins > 0 ? "next spawn in " + mins + " min" : "next spawn due now");
  }
  return parts.length ? "(" + parts.join(" · ") + ")" : "";
}

/**
 * What the panel says for one loop state — ringo's `/spawnloop/config` answer.
 * Ported from `renderSpawnLoop` (`webhook/dashboard.go`).
 *
 * Bundle mode fires the WHOLE next-bundle into one worker, so it names no
 * single story and offers no skip: it summarizes inline and lists every story.
 */
export function spawnLoopView(s, now = Date.now()) {
  const bundle = s.bundle_mode ? s.next_bundle || [] : [];
  let next = "next: nothing ready";
  let nextTitle = "";
  if (s.bundle_mode) {
    const loc = bundle.reduce((total, story) => total + (story.est_loc || 0), 0);
    if (bundle.length) {
      next = "next bundle: " + bundle.length + " stor" + (bundle.length === 1 ? "y" : "ies") +
        (loc ? " · ~" + loc + " LOC" : "");
      nextTitle = bundle.map((story) => story.id).join("\n");
    } else if (s.next_bundle_err) {
      next = "next bundle: unavailable";
      nextTitle = s.next_bundle_err;
    } else {
      // Also the cold-start state: the first preview fetch is still in flight.
      next = "next bundle: nothing ready";
    }
  } else if (s.next && s.next.id) {
    next = "next: " + (s.next.title || s.next.id);
    nextTitle = s.next.id;
  }
  return {
    enabled: !!s.enabled, toggle: s.enabled ? "Pause" : "Play",
    liveCap: s.live_cap, queueCap: s.queue_cap,
    interval: Math.round((s.stagger_seconds || 0) / 60),
    bundleMode: !!s.bundle_mode,
    liveNow: "(now: " + (s.live_now || 0) + ")", openNow: "(now: " + (s.open_now || 0) + ")",
    lastSpawn: spawnTiming(s, now),
    next, nextTitle,
    skip: !s.bundle_mode && !!(s.next && s.next.id),
    bundleList: bundle
      .map((story) =>
        '<div class="bl-row"><span class="bl-loc">' + (story.est_loc ? story.est_loc + " LOC" : "—") +
        '</span><span class="bl-title"><a href="/story/' + encodeURIComponent(story.id) +
        '" title="' + esc(story.id) + '">' + esc(story.title || story.id) + "</a></span></div>")
      .join(""),
  };
}

/** ringo's `/broadcast` answer as the box's note, or null for one it cannot read. */
function broadcastSent(text) {
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    return null;
  }
  const failed = (out.sent || []).filter((s) => s.error).length;
  return {
    complete: !failed,
    note:
      "sent to " + out.pane_count + " pane" + (out.pane_count === 1 ? "" : "s") +
      (out.skipped ? " (" + out.skipped + " pane gone)" : "") +
      (failed ? " — " + failed + " failed" : ""),
  };
}

/** The palette's one input: a search or a pane message. */
export const PALETTE_INPUT = "paletteInput";

/** The spawn dialog's task box: a prompt is often long, so it is not the palette's one line. */
export const SPAWN_TASK = "spawnTask";

/** The broadcast dialog's message box: like a spawn's task, often more than a line. */
export const BROADCAST_MESSAGE = "broadcastMessage";

/**
 * Which audience a key in the broadcast dialog sends to, or null: ⌘/Ctrl+Enter
 * is the audience the dialog was opened for (everyone, unless the palette's
 * CI-red action opened it), with Shift the CI-red ones. A bare Enter is a newline.
 */
export function broadcastKey(event, audience = "all") {
  if (event.isComposing || event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.altKey) return null;
  return event.shiftKey ? "ci-red" : audience;
}

/** The broadcast dialog's buttons, every one of which a send holds. */
export const BROADCAST_BUTTONS = ["bcastAll", "bcastCIRed"];

/**
 * The usage-scraper pill for ringo's usage answer (`renderUsage`,
 * `dashboard.go:1592-1605`): on while the browser watch is connected and
 * fresh, stale while connected with an old last scrape, off when it is not
 * connected at all.
 */
export function usageScraperPill(u, now = Date.now()) {
  const state = u.watchConnected ? (u.stale ? "stale" : "on") : "off";
  let title = "claude.ai usage scraper (local browser watch)";
  if (u.lastCheckTime) title += " — last check " + timeAgo(u.lastCheckTime, now);
  if (u.lastError) title += " — error: " + u.lastError;
  return { state, title };
}

/**
 * What the two broadcast buttons say for ringo's `/broadcast/targets` counts.
 * "all" carries its size so it never turns out to mean nobody; "CI red" is
 * hidden at zero, because its absence is the signal (`dashboard.go:2092`).
 */
export function broadcastButtons(counts) {
  const all = (counts && counts.all) || 0;
  const red = (counts && counts["ci-red"]) || 0;
  return {
    all: { text: "all (" + all + ")", dim: all === 0 },
    ciRed: { text: "CI red (" + red + ")", hidden: red === 0 },
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/*
 * GitHub octicons, inlined so a PR, spawn or merged row shows the same status
 * circle the backlog list does. Fill comes from `.ricon svg` in the shell CSS.
 */
/** A 16px octicon from its path markup, filled by the stylesheet. */
export const OCTICON = (paths) => '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' + paths + "</svg>";

export const ICONS = {
  issue: OCTICON('<path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"></path><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"></path>'),
  pr: OCTICON('<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"></path>'),
  pencil: OCTICON('<path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"></path>'),
  draft: OCTICON('<path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z"></path>'),
  merge: OCTICON('<path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z"></path>'),
  eye: OCTICON('<path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.825.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z"></path>'),
  review: OCTICON('<path d="M1.75 1h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 13H8.061l-2.574 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25v-8.5C0 1.784.784 1 1.75 1ZM1.5 2.75v8.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25Zm5.28 1.72a.75.75 0 0 1 0 1.06L5.31 7l1.47 1.47a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-2-2a.75.75 0 0 1 0-1.06l2-2a.75.75 0 0 1 1.06 0Zm2.44 0a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1 0 1.06l-2 2a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L10.69 7 9.22 5.53a.75.75 0 0 1 0-1.06Z"></path>'),
  sync: OCTICON('<path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"></path>'),
  ready: OCTICON('<path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm1.5 0a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm10.28-1.72-4.5 4.5a.75.75 0 0 1-1.06 0l-2-2a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l1.47 1.47 3.97-3.97a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z"></path>'),
  check: OCTICON('<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>'),
  x: OCTICON('<path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path>'),
  dot: OCTICON('<path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"></path>'),
};

export const CI_TITLES = { success: "CI passing", failure: "CI failing", pending: "CI running" };

/** The one row shape every list on this page uses. */
export function row({ icon, iconCls, title, meta, aside, panes, cls }) {
  return (
    '<div class="row' + (cls || "") + '">' +
    '<span class="ricon' + (iconCls ? " " + iconCls : "") + '">' + ICONS[icon] + "</span>" +
    '<div class="rmain"><div class="titleline">' + title + "</div>" +
    '<div class="rmeta">' + meta + "</div></div>" +
    '<div class="raside">' +
    (aside ? '<div class="aside-top">' + aside + "</div>" : "") +
    (panes ? '<div class="panes">' + panes + "</div>" : "") +
    "</div></div>"
  );
}

/**
 * A pane in `limit` or `waiting` overrides whatever the row would otherwise
 * say, because both mean the row is not moving and the reason is not the one
 * the workflow status would give.
 */
export function paneOverridePill(paneStatus) {
  if (paneStatus === "limit") return '<span class="' + statusClass("limit reached") + '">limit reached</span>';
  if (paneStatus === "waiting") return '<span class="' + statusClass("waiting for answer") + '">waiting for answer</span>';
  return null;
}

/** One live grooming agent (RFC refine / sunset): links an RFC, never a PR. */
export function rfcSpawnRow(s, now = Date.now()) {
  const verb = s.kind === "rfc-sunset" ? "sunsetting" : "refining";
  const url = "/rfc/" + encodeURIComponent(s.story_id);
  const label =
    paneOverridePill(s.pane_status) || '<span class="' + statusClass(verb) + '">' + verb + "</span>";
  const meta = ['<a href="' + url + '"><code>' + esc(s.story_id) + "</code></a>"];
  if (s.at) meta.push("spawned " + timeAgo(s.at, now) + (s.source ? " via " + esc(s.source) : ""));
  return row({
    icon: "issue",
    iconCls: s.pane_status === "waiting" ? "waiting" : "",
    title: '<a class="rtitle" href="' + url + '">' + esc(s.title || s.story_id) + "</a>" + label,
    meta: meta.join(" &middot; "),
    panes: paneLine(WORK_EMOJI, s.pane, s.pane_status, s.pane_input),
    cls: " spawn",
  });
}

/**
 * Whether a PR's row shows the cancel-cleanup control. Not with no pane, no
 * cleanup — Go's zero time, `0001-01-01T00:00:00Z` — or a deadline more than a
 * minute gone, by which time the quit has gone out. ringo's `renderInto`
 * (`dashboard.go:1363`).
 */
export function cleanupPending(pr, now = Date.now()) {
  if (!pr.pane || !pr.teardownAt || String(pr.teardownAt).startsWith("0001")) return false;
  return Date.parse(pr.teardownAt) - now > -60000;
}

/** The "closing in Ns" pill and its "cancel cleanup" button, or nothing. */
export function cleanupControl(pr, now = Date.now()) {
  if (!cleanupPending(pr, now)) return "";
  const seconds = Math.max(0, Math.round((Date.parse(pr.teardownAt) - now) / 1000));
  return (
    '<span class="Label" title="Pane cleanup pending">closing in ' + seconds + "s</span>" +
    control("cancel-cleanup", { pane: pr.pane }, { cls: "act", title: "Keep this pane open", label: "cancel cleanup" })
  );
}

/**
 * The six stages a session moves through, in order. `sessionStage` returns
 * one of these ids; the row's stage label names it.
 */
export const STAGES = [
  ["drafting", "Drafting"],
  ["self", "Self review"],
  ["ringo", "Reviewer convergence"],
  ["ci", "Getting CI green"],
  ["ready", "Ready to merge"],
  ["merged", "Merged"],
];

/**
 * Where a session is in its work: RFC 0232's decision list, checked top to
 * bottom, first match wins, and the last rule matches everything.
 *
 * `row` is a PR row (it carries `pr`) or a spawn row (it does not).
 * `reviewers` is the map `reviewersByKey` builds; an entry for the PR means
 * a reviewer is assigned. `reported` is the stage the agent reported for its
 * story, and it refines a spawn with no PR only: every other rule rests on
 * PR facts, which outrank anything an agent says about itself.
 */
export function sessionStage(row, reviewers = null, reported = null) {
  if (row.merged) return "merged";
  if (row.pr == null) return reported === "self" ? "self" : "drafting";
  const findings = (row.openFindings || 0) > 0;
  if (!row.draft && row.ciStatus === "success" && !findings) return "ready";
  const assigned = !!(reviewers && reviewers[reviewerKey(row.owner, row.repo, row.pr)]);
  if (assigned || findings) return "ringo";
  if (row.draft && !(row.reviewCycles > 0)) return "self";
  return "ci";
}


/** Each stage's octicon: pencil, eye, code review, sync, check-circle, merge. */
export const STAGE_ICONS = {
  drafting: ICONS.pencil,
  self: ICONS.eye,
  ringo: ICONS.review,
  ci: ICONS.sync,
  ready: ICONS.ready,
  merged: ICONS.merge,
};

/** A session's stage as a GitHub label: the stage's octicon and its name, in the stage's colour. */
export function stageLabel(stage) {
  return '<span class="Label stage st-' + stage + '">' + STAGE_ICONS[stage] + stageName(stage) + "</span>";
}

/**
 * A PR's CI rollup as GitHub draws it beside a title: a green check, a red x,
 * or a yellow dot. A failure says how many checks failed when ringo counted them.
 */
export function ciMark(status, failed = 0) {
  const icon = { success: "check", failure: "x", pending: "dot" }[status];
  if (!icon) return "";
  const failure = failed > 0 ? plural(failed, "check") + " failed" : "check failed";
  const label = status === "failure" ? failure : CI_TITLES[status];
  return (
    '<span class="ci ci-' + status + '" title="' + label + '">' + ICONS[icon] +
    '<span class="sr-only">' + label + "</span></span>"
  );
}

/** A stage's name. */
export const stageName = (stage) => (STAGES.find(([id]) => id === stage) || ["", ""])[1];

/**
 * The one progress figure for the current stage, or '' (RFC 0232, "The session
 * list"): LOC against the ceiling while drafting and in self review, findings
 * converged against the review's total in review, checks passed while getting
 * CI green. A ringo that predates those counts leaves the older figures.
 */
export function stageFigure(row, stage) {
  if (stage === "drafting" || stage === "self") {
    if (!row.locCeiling) return "";
    return (row.additions || 0) + (row.deletions || 0) + "/" + row.locCeiling + " LOC";
  }
  if (stage === "ringo") {
    if (row.findingsTotal > 0) {
      const open = Math.min(row.openFindings || 0, row.findingsTotal);
      return row.findingsTotal - open + "/" + row.findingsTotal + " findings converged";
    }
    if ((row.openFindings || 0) > 0) return plural(row.openFindings, "open finding");
    return row.reviewCycles ? plural(row.reviewCycles, "review cycle") : "";
  }
  if (stage === "ci") {
    if (row.checksTotal > 0) return (row.checksPassed || 0) + "/" + row.checksTotal + " checks passed";
    return CI_TITLES[row.ciStatus] || "";
  }
  return "";
}

// ---------------------------------------------------------------------------
// The queue, and the stalled and the stranded
// ---------------------------------------------------------------------------

const MESSAGE_KINDS = [
  ["Copilot reviewed", "copilot review"],
  ["CI failed", "CI failure"],
  ["has been merged", "merge"],
  ["has been opened", "PR opened"],
  ["merge conflicts", "merge conflict"],
];

/** What a held-back notification is about: ringo's `msgType` (`dashboard.go:1882`). */
export const messageKind = (message) =>
  (MESSAGE_KINDS.find(([says]) => String(message || "").includes(says)) || ["", "notification"])[1];

/**
 * A PR row with the notifications ringo's usage gate is holding for it under
 * it, each with a button that sends it now. The entries are Go structs.
 */
export function queuedUnder(pr, queue, html) {
  return (
    html +
    (queue || [])
      .filter((q) => q.Owner === pr.owner && q.Repo === pr.repo && q.PR === pr.pr)
      .map(
        (q) =>
          '<div class="queued-row"><span class="queued">queued: </span>' +
          '<span class="muted">' + messageKind(q.Message) + "</span> " +
          control("send-one", { pr: pr.pr }, { cls: "btn btn-sm btn-green", title: "Send this to the pane now", label: "send" }) +
          "</div>",
      )
      .join("")
  );
}

/** The queue card: how many are held, and the button that sends them all. '' when none. */
export function queueCard(queue) {
  if (!queue || !queue.length) return "";
  return (
    '<div class="card-head"><span class="queued">' + queue.length + " queued</span>" +
    control("drain", {}, { cls: "btn btn-sm", title: "Send every queued notification now", label: "Send All" }) +
    "</div>"
  );
}

/** Every pane drawn red (API error, stuck retry): who a poke would reach.
 * ringo's `collectRedPanes` (`dashboard.go:2243`), field names and all. */
export function redPanes(prs, spawns, reviewers) {
  const red = new Set();
  (prs || []).forEach((pr) => pr.paneStatus === "error" && pr.pane && red.add(pr.pane));
  (spawns || []).forEach((s) => s.pane_status === "error" && s.pane && red.add(s.pane));
  Object.values(reviewers || {}).forEach((e) => e && e.pane_status === "error" && e.pane_id && red.add(e.pane_id));
  return [...red];
}

/** The poke button for those panes: hidden with nobody to poke, and it says how many. */
export function pokeButton(panes) {
  return {
    hidden: !panes.length,
    panes: panes.join(","),
    label: "👉 poke " + plural(panes.length, "stalled agent"),
  };
}

/**
 * Which agent's reviewers can be drained onto the other: one with a pane on
 * its limit banner and a review still owed. With both out there is nowhere to
 * drain to, so neither is offered (`updateDrainFields`, `dashboard.go:927`).
 */
export function strandedAgents(reviewers) {
  const on = (agent) =>
    Object.values(reviewers || {}).some((e) => e && e.agent === agent && e.blocked_by_usage && e.review_owed);
  const codex = on("codex");
  const claude = on("claude");
  return { codex: codex && !claude, claude: claude && !codex };
}

/** One answer from a drain, running or finished, as its status line. */
export function drainStatus(d) {
  if (d.running) return "draining " + (d.done || 0) + "/" + (d.total || 0) + "...";
  if (!d.total) return "nothing to drain";
  const count = (list, word) => ((list || []).length ? ", " + list.length + " " + word : "");
  return (d.drained || []).length + " moved" + count(d.cleaned, "cleaned") + count(d.skipped, "skipped");
}

/*
 * "Agents waiting on you": an agent's AskUserQuestion, parked by a hook. The
 * one panel whose text a MODEL wrote, so every string goes through `esc`, in
 * text and attributes alike. ringo's second escaper is for what it pastes
 * into inline `onclick` JavaScript; a `data-` attribute is only an attribute.
 */

/** A picked option sends its label, under its question when several were asked. */
export function askAnswer(ask, question, label) {
  return (ask.questions || []).length > 1 ? question.question + " → " + label : label;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

const HOUR = 3600000;
const WEEK_HOURS = 168;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** ringo's thresholds (`dashboard.go:1371`). */
export function barColor(percent) {
  if (percent >= 85) return "red";
  if (percent >= 60) return "yellow";
  return "green";
}

/**
 * The weekly bar is coloured by PACE: `diff` is percent used minus percent of
 * the week gone. As hours, green within 6 of pace, yellow within 18
 * (`dashboard.go:1379`).
 */
export function weeklyPaceColor(diff) {
  const hours = (Math.abs(diff) / 100) * WEEK_HOURS;
  if (hours <= 6) return "green";
  if (hours <= 18) return "yellow";
  return "red";
}

/**
 * The next reset a label names, or null: absolute ("Thu 3:00 PM", in the
 * viewer's zone) or a duration ("in 5 days, 3 hours", codex's "in 3d 4h").
 * Verbose units are tried first, so "5 days" never also matches the "d" rule.
 */
export function parseResetDate(s, now = Date.now()) {
  if (!s) return null;
  const abs = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\w*\s+(\d+):(\d+)\s*(AM|PM)$/i.exec(s);
  if (abs) {
    const day = DAYS.findIndex((d) => d.toLowerCase() === abs[1].slice(0, 3).toLowerCase());
    let hour = parseInt(abs[2], 10);
    const pm = abs[4].toUpperCase() === "PM";
    if (pm && hour !== 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
    const reset = new Date(now);
    reset.setHours(hour, parseInt(abs[3], 10), 0, 0);
    let ahead = (day - reset.getDay() + 7) % 7;
    if (ahead === 0 && reset.getTime() <= now) ahead = 7;
    reset.setDate(reset.getDate() + ahead);
    return reset;
  }
  const unit = (verbose, short) => {
    const m = s.match(verbose) || s.match(short);
    return m ? parseInt(m[1], 10) : 0;
  };
  const hours =
    unit(/(\d+)\s*day/, /(\d+)\s*d\b/) * 24 + unit(/(\d+)\s*h(?:ou)?r/, /(\d+)\s*h\b/) +
    unit(/(\d+)\s*min/, /(\d+)\s*m\b/) / 60;
  return hours > 0 ? new Date(now + hours * HOUR) : null;
}

/**
 * `at`, the reset as epoch millis, wins: the string carries no zone, so the
 * scraper's UTC "Tue 6:00 PM" would be read as 6PM in the VIEWER's.
 */
export const resetDate = (s, at, now = Date.now()) => (at ? new Date(at) : parseResetDate(s, now));

function clock(d) {
  return (d.getHours() % 12 || 12) + ":" + String(d.getMinutes()).padStart(2, "0") + (d.getHours() >= 12 ? " PM" : " AM");
}

/** "Wed 1:20 PM" when a reset time can be derived; the raw label, or "?", when not. */
export function formatResetLabel(s, at, now = Date.now()) {
  const d = resetDate(s, at, now);
  return d ? DAYS[d.getDay()] + " " + clock(d) : s || "?";
}

/** The same without the day: a session window is short enough that it is noise. */
export function formatClockLabel(s, at, now = Date.now()) {
  const d = resetDate(s, at, now);
  return d ? clock(d) : s || "?";
}

export function hoursUntilReset(s, at, now = Date.now()) {
  const d = resetDate(s, at, now);
  return d ? Math.max(0, (d.getTime() - now) / HOUR) : null;
}

export function weekElapsedPercent(weeklyResets, at, now = Date.now()) {
  const left = hoursUntilReset(weeklyResets, at, now);
  if (left === null) return 0;
  return Math.min(100, Math.round((Math.max(0, WEEK_HOURS - left) / WEEK_HOURS) * 100));
}

/** "42% of week elapsed (1d 3h ahead)": how far usage is from the week's pace. */
export function paceText(elapsed, diff) {
  const hours = Math.round((Math.abs(diff) / 100) * WEEK_HOURS);
  const gap = hours >= 24 ? Math.floor(hours / 24) + "d " + (hours % 24) + "h" : hours + "h";
  return elapsed + "% of week elapsed" + (diff > 0 ? " (" + gap + " ahead)" : diff < 0 ? " (" + gap + " under)" : "");
}

const clamp = (percent) => Math.max(0, Math.min(100, Number(percent) || 0));

/**
 * One meter row, as in the mockup: a label, a thin bar and its percent. What
 * a wider panel used to print beside the bar (when it resets, the week's
 * pace) is the row's tooltip.
 */
function usageRow(label, percent, color, title = "", marks = "", below = "") {
  return (
    '<div class="usage-row"' + (title ? ' title="' + esc(title) + '"' : "") + "><span>" + esc(label) + "</span>" +
    '<span class="meter"><i class="bar-fill ' + color + '" style="width:' + clamp(percent) + '%"></i>' + marks + "</span>" +
    "<span>" + clamp(percent) + "%</span>" + below + "</div>"
  );
}

/**
 * The week's midnights as offsets into the window, each with its day's short
 * name: ringo's `renderDayMarkers`. The window is the 168 hours before the
 * reset; without one it is taken to start now.
 */
export function weekTicks(weeklyResets, at, now = Date.now()) {
  const left = hoursUntilReset(weeklyResets, at, now);
  const start = now - Math.max(0, WEEK_HOURS - (left === null ? WEEK_HOURS : left)) * HOUR;
  const midnight = new Date(start);
  midnight.setHours(24, 0, 0, 0);
  const ticks = [];
  for (let d = new Date(midnight); ; d.setDate(d.getDate() + 1)) {
    const hours = (d.getTime() - start) / HOUR;
    if (hours >= WEEK_HOURS) break;
    ticks.push({ percent: Math.round((hours / WEEK_HOURS) * 1000) / 10, day: DAYS[d.getDay()].slice(0, 2) });
  }
  return ticks;
}

/** A row's tooltip, after its own facts: the plan, where the agent reports one (Codex does). */
const withPlan = (title, u) => (u.planType ? title + " · " + u.planType + " plan" : title);

/**
 * The week's row, as ringo draws it: a tick and its day at each midnight, a
 * marker where now falls in the window, and under the bar how far usage is
 * ahead of or under that pace, ahead in yellow.
 */
function weekRow(agent, u, now) {
  if (resetPassed(u.weeklyResetsAt, now)) return staleWeekRow(agent, u, now);
  const elapsed = weekElapsedPercent(u.weeklyResets, u.weeklyResetsAt, now);
  const diff = clamp(u.weeklyPercent) - elapsed;
  const title = "resets " + formatResetLabel(u.weeklyResets, u.weeklyResetsAt, now);
  const marks =
    weekTicks(u.weeklyResets, u.weeklyResetsAt, now)
      .map((t) => '<b class="day-tick" style="left:' + t.percent + '%" data-day="' + t.day + '"></b>')
      .join("") + '<b class="now-mark" style="left:' + elapsed + '%"></b>';
  const pace = '<span class="usage-pace ' + (diff > 0 ? "ahead" : "under") + '">' + paceText(elapsed, diff) + "</span>";
  return usageRow(agent + " · week", u.weeklyPercent, weeklyPaceColor(diff), withPlan(title, u), marks, pace);
}

/**
 * Whether the week's reset is already behind now. Codex publishes limits only
 * while a session runs, so ringo can hand over a window that has ended; read
 * as current, it would draw 100% elapsed and a pace that means nothing.
 */
export const resetPassed = (at, now = Date.now()) => Boolean(at) && at <= now;

/** A week whose reset has passed: its last reading, and no now marker, ticks or pace. */
function staleWeekRow(agent, u, now) {
  const title = "reset " + formatResetLabel(u.weeklyResets, u.weeklyResetsAt, now) + " passed";
  const below = '<span class="usage-pace stale">reset passed; waiting for a new reading</span>';
  return usageRow(agent + " · week", u.weeklyPercent, barColor(clamp(u.weeklyPercent)), withPlan(title, u), "", below);
}

/** Below zero is a plan with no session limit (ringo's `handleUsage`), and none is a scrape without one: either way no row, rather than 0%. */
const hasSession = (u) => u.sessionPercent != null && u.sessionPercent >= 0;

const sessionRow = (agent, u, now) =>
  hasSession(u)
    ? usageRow(agent + " · session", u.sessionPercent, barColor(clamp(u.sessionPercent)), withPlan("resets " + formatClockLabel(u.sessionResets, u.sessionResetsAt, now), u))
    : "";

/** The Usage panel's one-line summary, which is all a folded panel shows on a phone. */
export function usageSummary(u, now = Date.now()) {
  const parts = [];
  if (hasSession(u)) parts.push("session " + clamp(u.sessionPercent) + "%");
  if (u.weeklyPercent != null) parts.push("week " + clamp(u.weeklyPercent) + "%");
  if (u.manualPause) parts.push("paused" + (u.queueSize ? " · " + Number(u.queueSize) + " queued" : ""));
  if (u.lastCheckTime) parts.push("updated " + timeAgo(u.lastCheckTime, now));
  return parts.join(" · ");
}

/**
 * Claude's rows, from ringo's `/usage-status` (`renderUsage`): the week, the
 * session window and each model's week. Extra usage gets a line only while
 * it is on, since then it is spending.
 */
export function claudeUsage(u, now = Date.now()) {
  const money = (n) => "$" + (Number(n) || 0).toFixed(2);
  const models = (u.weeklyModels || []).map((m) =>
    usageRow(m.name + " · week", m.percent, barColor(clamp(m.percent)), m.resets ? "resets " + formatResetLabel(m.resets, m.resetsAt, now) : ""),
  );
  const extra = u.extraEnabled
    ? '<div class="usage-note">Extra usage on · ' + money(u.extraSpent) + " spent · " + money(u.extraBalance) + " balance · $" + (Number(u.extraLimit) || 0) + " limit</div>"
    : "";
  return weekRow("Claude", u, now) + sessionRow("Claude", u, now) + models.join("") + extra;
}

/**
 * Codex's rows, from `/codex-usage-status` (`renderCodexUsage`). A percent
 * below zero is a window Codex did not report, and its row goes; with both
 * gone one line says so.
 */
export function codexUsage(u, now = Date.now()) {
  const rows = (u.weeklyPercent >= 0 ? weekRow("Codex", u, now) : "") + sessionRow("Codex", u, now);
  return rows || '<div class="usage-note">Codex' + (u.planType ? " (" + esc(u.planType) + ")" : "") + " · no limits reported yet; it publishes them only while a session runs.</div>";
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** Where a story goes when its RFC names no other repo, and always shown. */
export const DEFAULT_REPO = "blazetrailsdev/trails";

/** Rows have carried owner and repo separately since before there were two. */
export const repoOf = (pr) => (pr.owner ? pr.owner + "/" : "") + (pr.repo || "");

/**
 * A grooming agent: ringo's `rfc-refine` / `rfc-sunset` spawns, which name no
 * story and never open a PR. A `manual` spawn (/prompt-agent) also carries a
 * `kind`, but it is a worker like the loop's and renders as one.
 */
export const isGrooming = (s) => !!s.kind && s.kind !== "manual";

/**
 * Drop a spawn whose branch already has a real PR row -- the PR row takes over.
 *
 * Three ways to match, because none of them holds alone: the spawn's branch
 * keeps a `-<hex>` suffix while the PR it opens usually uses the bare story
 * slug, and a worker's PR is tracked against the same tmux pane it runs in,
 * which ties the two together even when neither name matches. Grooming agents
 * never open a PR, so none of it applies to them.
 *
 * ringo prunes these server-side as well; this is belt-and-braces against a
 * stale frame.
 */
export function visibleSpawns(prs, spawns) {
  const branches = new Set(prs.map((p) => p.branch).filter(Boolean));
  const panes = new Set(prs.map((p) => p.pane).filter(Boolean));
  return (spawns || []).filter(
    (s) => isGrooming(s) || (!branches.has(s.branch) && !branches.has(s.story_id) && !(s.pane && panes.has(s.pane))),
  );
}

/**
 * Group a frame into per-repo sections, default repo first and the rest
 * alphabetically -- a stable order, unlike insertion order, which tracks
 * whichever repo happened to own the first PR in the payload. The default repo
 * is always present even with nothing open; every other repo appears only when
 * it has something, so an idle repo leaves no empty heading behind.
 */
export function repoSections(prs, spawns) {
  const byRepo = new Map();
  const bucket = (name) => {
    if (!byRepo.has(name)) byRepo.set(name, { name, prs: [], spawns: [] });
    return byRepo.get(name);
  };
  bucket(DEFAULT_REPO);
  prs.forEach((pr) => bucket(repoOf(pr)).prs.push(pr));
  spawns.forEach((s) => bucket(s.repo || DEFAULT_REPO).spawns.push(s));

  const names = [...byRepo.keys()].filter((n) => n && n !== DEFAULT_REPO).sort();
  names.unshift(DEFAULT_REPO);
  return names.map((name) => byRepo.get(name));
}

// ---------------------------------------------------------------------------
// Pills
// ---------------------------------------------------------------------------

/** One entry per repo, sorted, so trails and tasks report separately. */
export function mainCIByRepo(failures) {
  const byRepo = new Map();
  (failures || []).forEach((f) => {
    const key = f.repo || f.owner + "/" + f.repo;
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key).push(f);
  });
  return [...byRepo.keys()].sort().map((repo) => ({ repo, items: byRepo.get(repo) }));
}

export function mainCITitle({ repo, items }, now = Date.now()) {
  return (
    repo + " main CI failing:\n" +
    items
      .map((f) => f.check + " · " + (f.sha || "").slice(0, 7) + (f.time ? " · " + timeAgo(f.time, now) : ""))
      .join("\n")
  );
}

/**
 * "pull failed" alone reads like a network or auth problem. Most of these are
 * a dirty canonical checkout blocking the rebase pull, on a repo that is
 * otherwise current -- so name the real cause.
 */
export function pullFailReason(err) {
  const e = String(err || "").toLowerCase();
  if (/unstaged changes|cannot pull with rebase|would be overwritten|commit or stash|local changes/.test(e))
    return "local edits block pull";
  if (/non-fast-forward|not possible to fast-forward|diverg/.test(e)) return "diverged — needs manual merge";
  if (/could not read username|authentication failed|permission denied|cannot run ssh|host key/.test(e))
    return "auth/network error";
  if (/conflict/.test(e)) return "merge conflict";
  return "pull failed";
}

export const pullFailLabel = (failures) =>
  failures.map((f) => f.repo + ": " + pullFailReason(f.error)).join(", ");

export const pullFailTitle = (failures) =>
  failures
    .map((f) =>
      f.owner + "/" + f.repo + " — " + pullFailReason(f.error) + "\n  " +
      String(f.error || "git pull failed").replace(/\n/g, "\n  "),
    )
    .join("\n");
