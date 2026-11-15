/*
 * The dashboard's session list (RFC 0232): one row per agent session, grouped
 * by repo and ordered by stage, with what used to live in panels -- an agent's
 * question, the CI fixer, a stall -- inside the row it is about.
 *
 * Pure, like `./fleet-format.js`: every function takes the frame and a context
 * and returns HTML or a decision, and `test/assets/fleet-sessions.test.js`
 * exercises them directly. `dashboard.js` assigns what they return.
 *
 * The context every row function reads:
 *
 *   now        epoch millis
 *   fixers     the envelope's fixer entries
 *   reviewers  `reviewersByKey`'s map, or null before the first answer
 *   queue      the notifications ringo's usage gate holds
 *   stories    `fleet/stories`' answer: a PR ref or story id to its stories
 *   asks       pending AskUserQuestions, from ringo's relay
 *   panes      `trackPanes`' map: a pane to its status and since when
 *   open       the keys of the expanded sessions
 *   log        a session key to the events recorded for it
 *   steps      a session key to its loaded transcript page
 *   since      when the page started recording, for "since <time>"
 */
import {
  CI_TITLES,
  STAGES,
  activeFixers,
  askAnswer,
  cleanupControl,
  control,
  esc,
  fixerPhase,
  isFixerPR,
  isFixerStory,
  paneHref,
  paneLine,
  paneOverridePill,
  plural,
  queuedUnder,
  reviewerKey,
  reviewerLine,
  rfcSpawnRow,
  sessionStage,
  stageFigure,
  stageName,
  stepper,
  timeAgo,
  workerLine,
  WORK_EMOJI,
} from "./fleet-format.js";

/** How long a worker pane sits idle, short of its next stage, before its row says it has stalled (RFC 0232 open question 6). */
export const STALL_MS = 15 * 60_000;

/** The most refs one `fleet/stories` request names (`FLEET_STORIES_MAX_REFS` on the server). */
export const STORIES_MAX_REFS = 100;

const isPR = (s) => s.pr != null;

/** A session's key: stable across frames, and safe as an element id. */
export function sessionKey(s) {
  const raw = isPR(s) ? "pr-" + s.owner + "-" + s.repo + "-" + s.pr : s.fixerOnly ? "fixer-" + s.owner + "-" + s.repo : "spawn-" + (s.branch || s.story_id || "");
  return "s-" + raw.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

/** How the tasks database writes a PR on a story: `repo#N`, no owner. */
export const prRef = (s) => s.repo + "#" + s.pr;

/** A session's pane and that pane's status, whichever row shape it is. */
const paneOf = (s) => s.pane || "";
const paneStatusOf = (s) => (isPR(s) ? s.paneStatus : s.pane_status) || "";

// ---------------------------------------------------------------------------
// Bundle stories
// ---------------------------------------------------------------------------

/**
 * The query string for one `fleet/stories` request: every PR in the frame,
 * open or merged, then every spawn's story, at most a hundred in all.
 */
export function storiesQuery(prs, spawns) {
  const refs = [...new Set((prs || []).map(prRef))].map((ref) => "pr[]=" + encodeURIComponent(ref));
  const ids = [...new Set((spawns || []).filter((s) => !s.kind && s.story_id).map((s) => s.story_id))].map(
    (id) => "story[]=" + encodeURIComponent(id),
  );
  return [...refs, ...ids].slice(0, STORIES_MAX_REFS).join("&");
}

/** A loop worker's branch is `<story-id>-<4 hex>`; this is the story id. */
export const branchStory = (branch) => String(branch || "").replace(/-[0-9a-f]{4}$/, "");

/**
 * The story a session is titled with, and the rest of its bundle. The lead is
 * the one whose id is the branch without its spawn suffix, else the first by
 * id (the server answers them by id). `null` while nothing is attributed yet.
 */
export function sessionStories(s, stories) {
  const list = ((stories || {})[isPR(s) ? prRef(s) : s.story_id] || []).slice();
  if (!list.length) return { lead: null, rest: [] };
  const wanted = branchStory(s.branch);
  const at = Math.max(0, list.findIndex((story) => story.id === wanted || story.id === s.branch));
  const [lead] = list.splice(at, 1);
  return { lead, rest: list };
}

/** The stage an agent reported for a spawn's story, which only a spawn may use. */
export function reportedStage(s, stories) {
  if (isPR(s)) return null;
  const [story] = (stories || {})[s.story_id] || [];
  return (story && story.stage) || null;
}

/** A session's stage, with its spawn's reported stage folded in. */
export const stageOf = (s, ctx) => sessionStage(s, ctx.reviewers, reportedStage(s, ctx.stories));

// ---------------------------------------------------------------------------
// Questions, stalls and the review loop
// ---------------------------------------------------------------------------

/** The pending question whose pane is this session's worker. */
export const askFor = (s, asks) => (paneOf(s) ? (asks || []).find((a) => a.pane === paneOf(s)) : undefined) || null;

/** The questions no session row matches, which get rows of their own. */
export function unmatchedAsks(asks, rows) {
  const panes = new Set(rows.map(paneOf).filter(Boolean));
  return (asks || []).filter((a) => !a.pane || !panes.has(a.pane));
}

/**
 * A question as a strip inside its row: "Waiting on you", each question with
 * a button per option, and a free answer. A MODEL wrote every string here,
 * so every one goes through `esc`, in text and attributes alike.
 */
export function askStrip(ask, now = Date.now()) {
  const questions = (ask.questions || [])
    .map((q) => {
      const options = (q.options || [])
        .map((o) =>
          control("answer-ask", { id: ask.id, answer: askAnswer(ask, q, o.label) }, {
            cls: "btn btn-sm",
            title: o.description ? o.description : "Answer with this option",
            label: esc(o.label),
          }),
        )
        .join("");
      return (
        '<p class="ask-text">' + (q.header ? '<span class="ask-hdr">' + esc(q.header) + "</span> " : "") + esc(q.question) + "</p>" +
        (options ? '<div class="ask-opts">' + options + "</div>" : "")
      );
    })
    .join("");
  return (
    '<div class="strip ask" role="group" aria-label="Question from ' + esc(ask.label) + '">' +
    '<span class="flag">Waiting on you</span>' +
    '<span class="ask-who">' + esc(ask.label) + (ask.pane ? " <code>" + esc(ask.pane) + "</code>" : "") + " · " + timeAgo(ask.at, now) + "</span>" +
    questions +
    '<div class="ask-free"><input type="text" class="ctl" aria-label="Answer in your own words" placeholder="…or answer in your own words" data-keep="ask-' + esc(ask.id) + '">' +
    control("answer-ask", { id: ask.id, free: 1 }, { cls: "btn btn-sm", title: "Send your own answer", label: "Send" }) +
    "</div></div>"
  );
}

/** A question no row matches, as a row of its own at the top of the list. */
export function askRow(ask, now = Date.now()) {
  return '<article class="session session-drafting needs orphan-ask">' + askStrip(ask, now) + "</article>";
}

/** The pane statuses that are not idle: busy, asking, failing, or out of quota (a prod reaches none of them). */
const BUSY = new Set(["working", "waiting", "error", "limit"]);

/**
 * The time each pane's status last changed, carried across frames: a pane
 * whose status is unchanged keeps its `since`, any other starts now. Panes
 * gone from the frame are dropped.
 */
export function trackPanes(previous, prs, spawns, now = Date.now()) {
  const next = new Map();
  for (const s of [...(prs || []), ...(spawns || [])]) {
    const pane = paneOf(s);
    if (!pane) continue;
    const status = paneStatusOf(s);
    const was = previous && previous.get(pane);
    next.set(pane, was && was.status === status ? was : { status, since: now });
  }
  return next;
}

/** How long the worker pane has been idle, or 0 while it is not. */
export function idleFor(s, panes, now = Date.now()) {
  if (!paneOf(s) || BUSY.has(paneStatusOf(s))) return 0;
  const seen = panes && panes.get(paneOf(s));
  return seen && seen.status === paneStatusOf(s) ? Math.max(0, now - seen.since) : 0;
}

/**
 * Whether a session has stalled short of its next stage, and what to say to
 * its agent: RFC 0232's table, as `{ idle, ok, open, message }`, or null. A
 * session with an open question is never also stalled; the question is what
 * it waits on.
 */
export function sessionStall(s, ctx) {
  if (s.merged || askFor(s, ctx.asks)) return null;
  const idle = idleFor(s, ctx.panes, ctx.now);
  if (idle < STALL_MS) return null;
  const stage = stageOf(s, ctx);
  const entry = ctx.reviewers ? ctx.reviewers[reviewerKey(s.owner, s.repo, s.pr)] : null;
  const findings = s.openFindings || 0;
  if (stage === "self" && !entry) return { idle, ok: ["still a draft"], open: ["no reviewer asked"], message: "Request review?" };
  // Converged means a round has come back with nothing open: a reviewer
  // assigned and not yet heard from is not a review the agent can move past.
  if (stage === "ringo" && findings === 0 && (s.reviewCycles || 0) > 0 && !(entry && entry.review_owed)) {
    return { idle, ok: ["no open findings"], open: [], message: "Move on to CI?" };
  }
  if (stage === "ci" && s.ciStatus === "failure") return { idle, ok: [], open: ["a check failed"], message: "Fix the failing check?" };
  if (stage === "ci" && s.ciStatus === "success" && findings === 0 && s.draft) {
    return { idle, ok: ["CI green", "no open findings"], open: ["PR still a draft"], message: "Mark it ready?" };
  }
  return null;
}

/** The stall strip: how long, the evidence, and the one button that messages the agent. */
export function stallStrip(s, stall) {
  const key = sessionKey(s);
  return (
    '<div class="strip stall" role="group" aria-label="Stalled">' +
    '<span class="flag idle">Stalled · idle ' + Math.floor(stall.idle / 60_000) + "m</span>" +
    '<p class="evidence">' +
    stall.ok.map((w) => '<span class="met">' + esc(w) + "</span>").join("") +
    stall.open.map((w) => "<span>" + esc(w) + "</span>").join("") +
    "</p>" +
    '<button class="btn btn-sm" data-action="pane-send" data-pane="' + esc(paneOf(s)) + '" data-key="' + key +
    '" data-text="' + esc(stall.message) + '" data-says="stall-note-' + key + '" aria-label="Message the agent: ' + esc(stall.message) +
    '" title="Sends this as a message to the agent">' + esc(stall.message) + "</button>" +
    '<span class="field-status" id="stall-note-' + key + '"></span>' +
    "</div>"
  );
}

/**
 * Whose turn it is in a review: the side whose pane is working, else the
 * reviewer while a review is owed, else the agent.
 */
export function reviewTurn(workerStatus, entry) {
  if (workerStatus === "working") return "agent";
  if (entry && entry.pane_status === "working") return "reviewer";
  if (entry && entry.review_owed) return "reviewer";
  return "agent";
}

/** What the reviewer is doing, from its entry: the long form, for the ring's label. */
function reviewerDoing(entry) {
  if (!entry) return "no reviewer";
  if (entry.pane_status === "working") return "reviewing";
  if (entry.review_owed) return entry.pane_id ? "owes a review" : "owes a review, no pane";
  return "waiting on the agent";
}

/**
 * The two lines around the ring, written for the stepper column: who acts and
 * a short verb. The agent works ("fixing" once a round has passed), waits on
 * an owed review, or idles; the reviewer, named by its pane, reviews, owes
 * one, or waits. ringo's last-action text is too long for it and goes in the
 * ring's tooltip instead.
 */
export function reviewLines(s, entry) {
  const turn = reviewTurn(s.paneStatus, entry);
  const agent = s.paneStatus === "working" ? (s.reviewCycles ? "fixing" : "working") : turn === "reviewer" ? "waiting" : "idle";
  let reviewer = "none";
  if (entry) {
    const verb = entry.pane_status === "working" ? "reviewing" : entry.review_owed ? (entry.pane_id ? "owes review" : "no pane") : "waiting";
    reviewer = (entry.pane_id ? entry.pane_id + " " : "") + verb;
  }
  return { agent, reviewer };
}

/**
 * The review loop at Reviewer convergence: a ring in place of the stage icon,
 * the agent on top and the reviewer below, the one whose turn it is filled,
 * the round in the middle, and a short line for what each side is doing. It
 * spins only while a side is working.
 */
export function reviewRing(s, entry) {
  const turn = reviewTurn(s.paneStatus, entry);
  const working = s.paneStatus === "working" || !!(entry && entry.pane_status === "working");
  const agentLong = s.lastAction || (s.paneStatus === "working" ? "working" : "idle");
  const round = s.reviewCycles || 0;
  const label = "Review round " + round + ". Agent: " + agentLong + ". Reviewer: " + reviewerDoing(entry) + ".";
  const lines = reviewLines(s, entry);
  return (
    '<span class="ring' + (working ? " spinning" : "") + '" role="img" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
    '<span class="ring-line agent-line"><b>Agent</b> ' + esc(lines.agent) + "</span>" +
    '<span class="ring-body">' +
    '<span class="ring-side top' + (turn === "agent" ? " turn" : "") + '"></span>' +
    '<span class="ring-round">' + round + "</span>" +
    '<span class="ring-side bottom' + (turn === "reviewer" ? " turn" : "") + '"></span>' +
    "</span>" +
    '<span class="ring-line reviewer-line"><b>Reviewer</b> ' + esc(lines.reviewer) + "</span>" +
    "</span>"
  );
}

// ---------------------------------------------------------------------------
// The CI fixer
// ---------------------------------------------------------------------------

/**
 * Each active fixer joined to the session it works in: the PR row it opened,
 * else the spawn on its story. A fixer with neither becomes a Drafting row of
 * its own with no PR. Returns the fixer per session key, and those rows.
 */
export function joinFixers(fixers, prs, spawns) {
  const byKey = new Map();
  const orphans = [];
  for (const f of activeFixers(fixers)) {
    const row =
      (prs || []).find((pr) => isFixerPR([f], pr)) ||
      (spawns || []).find((s) => !s.kind && isFixerStory([f], s.story_id));
    if (row) byKey.set(sessionKey(row), f);
    else {
      const orphan = { owner: f.owner, repo: f.owner + "/" + f.repo, story_id: f.story_id, fixerOnly: true, title: "main is red" };
      byKey.set(sessionKey(orphan), f);
      orphans.push(orphan);
    }
  }
  return { byKey, orphans };
}

/** The fixer row's note: its phase, the red checks and the red commit, and the respawn lever. */
export function fixerNote(f) {
  const repo = f.owner + "/" + f.repo;
  const parts = ['<span class="fixer-phase ' + fixerPhase(f) + '">' + fixerPhase(f) + "</span>"];
  if ((f.consecutive_red || 0) > 1) parts.push(f.consecutive_red + "&times; consecutive red");
  if (f.checks && f.checks.length) parts.push('<span class="fixer-checks">' + f.checks.map(esc).join(", ") + "</span>");
  if (f.red_sha) {
    const sha = "<code>" + esc(f.red_sha.slice(0, 8)) + "</code>";
    parts.push(f.red_url ? '<a href="' + esc(f.red_url) + '" target="_blank">' + sha + "</a>" : sha);
  }
  if (f.awaiting_rebase && f.awaiting_rebase.length) {
    parts.push(
      "awaiting rebase: " +
        f.awaiting_rebase.map((n) => '<a href="https://github.com/' + esc(repo) + "/pull/" + n + '" target="_blank">#' + n + "</a>").join(" "),
    );
  }
  // The manual lever for a wedged coordinator, offered while a red is recorded.
  if (f.red_sha) {
    parts.push(
      control("respawn-fixer", { owner: f.owner, repo: f.repo }, {
        cls: "btn btn-sm",
        title: "Discard the tracked fixer story and spawn a fresh worker for this red",
        label: f.story_id ? "respawn fixer" : "spawn fixer",
      }),
    );
  }
  return parts.join(" &middot; ");
}

/** Where the main CI pill for a repo links: its fixer's row. */
export const fixerAnchor = (repo) => "fixer-" + String(repo).replace(/[^a-zA-Z0-9_-]+/g, "-");

// ---------------------------------------------------------------------------
// Needs you
// ---------------------------------------------------------------------------

/**
 * Whether a row wants something from the operator: an open question, a
 * failed check, a stall, or a merge waiting. The CI fixer's row is not
 * counted: a red main is not waiting on an answer (open question 5).
 */
export function sessionNeeds(s, ctx, fixer = null) {
  if (fixer || s.merged || s.kind) return false;
  if (askFor(s, ctx.asks)) return true;
  if (isPR(s) && s.ciStatus === "failure") return true;
  if (stageOf(s, ctx) === "ready") return true;
  return !!sessionStall(s, ctx);
}

// ---------------------------------------------------------------------------
// The session log
// ---------------------------------------------------------------------------

/**
 * What changed for each session between two frames, as log entries: a PR
 * opened, reviewed, failing or passing CI, merged, and every stage change.
 * `previous` is the last frame's rows by key (empty on a cold load, which
 * records nothing: the log starts "since" the page did).
 */
export function frameEvents(previous, rows, ctx) {
  const events = [];
  if (!previous) return events;
  const at = new Date(ctx.now).toISOString();
  for (const s of rows) {
    const key = sessionKey(s);
    const was = previous.get(key);
    if (!was) {
      events.push({ key, at, text: isPR(s) ? "PR #" + s.pr + " opened" : "session spawned" });
      continue;
    }
    if (isPR(s) && !isPR(was.row)) events.push({ key, at, text: "PR #" + s.pr + " opened" });
    if (isPR(s) && (s.reviewCycles || 0) > (was.row.reviewCycles || 0)) events.push({ key, at, text: "reviewed, round " + s.reviewCycles });
    if (isPR(s) && s.ciStatus !== was.row.ciStatus && (s.ciStatus === "failure" || s.ciStatus === "success")) {
      events.push({ key, at, text: s.ciStatus === "failure" ? "CI failed" : "CI passed" });
    }
    if (s.merged && !was.row.merged) events.push({ key, at, text: "merged" });
    if (was.stage !== stageOf(s, ctx)) events.push({ key, at, text: "stage: " + stageName(stageOf(s, ctx)) });
  }
  return events;
}

/** The rows of a frame by key, with their stages, for the next `frameEvents`. */
export function frameRows(rows, ctx) {
  return new Map(rows.map((s) => [sessionKey(s), { row: s, stage: stageOf(s, ctx) }]));
}

const clockOf = (at) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
};

/**
 * A session's log, oldest first: the recorded events, the messages sent from
 * this page, and the transcript's steps once loaded, in time order.
 */
export function logEntries(events, steps) {
  const fromSteps = (steps || []).map((st) => ({
    at: st.at,
    kind: st.kind,
    text: st.kind === "tool" ? st.tool + " " + st.text : st.text,
    error: !!st.error,
    i: st.i,
  }));
  const all = [...(events || []).map((e) => ({ kind: e.kind || "event", at: e.at, text: e.text })), ...fromSteps];
  return all
    .map((e, n) => ({ e, n }))
    .sort((a, b) => Date.parse(a.e.at) - Date.parse(b.e.at) || a.n - b.n)
    .map(({ e }) => e);
}

const LOG_LABELS = { event: "event", you: "you", user: "prompt", text: "agent", tool: "tool", note: "note" };

/** The log's markup: a "since" line on a cold load, an earlier-steps button when there are more. */
export function logHtml(s, ctx) {
  const key = sessionKey(s);
  const page = (ctx.steps && ctx.steps.get(key)) || null;
  const entries = logEntries((ctx.log && ctx.log.get(key)) || [], page ? page.steps : []);
  const oldest = page && page.steps.length ? Math.min(...page.steps.map((st) => st.i)) : 0;
  const head = [];
  if (page && oldest > 0) {
    head.push('<button class="btn btn-sm" data-ui="log-earlier" data-key="' + key + '" data-before="' + oldest + '">Load earlier steps</button>');
  }
  if (page && page.archives > 1 && isPR(s)) {
    head.push(
      '<a href="/sessions/' + esc(s.owner) + "/" + esc(s.repo) + "/" + s.pr + '">' + plural(page.archives - 1, "earlier archive") + "</a>",
    );
  }
  if (page && page.error) head.push('<span class="bad">' + esc(page.error) + "</span>");
  if (ctx.since) head.push('<span class="muted">events since ' + clockOf(ctx.since) + "</span>");
  const rows = entries.length
    ? entries
        .map(
          (e) =>
            '<div class="log-row log-' + e.kind + (e.error ? " bad" : "") + '"><span class="log-at">' + clockOf(e.at) +
            '</span><span class="log-kind">' + (LOG_LABELS[e.kind] || e.kind) + '</span><span class="log-text">' + esc(e.text) + "</span></div>",
        )
        .join("")
    : '<div class="log-row"><span class="muted log-empty">Nothing recorded yet.</span></div>';
  return '<div class="log-head">' + head.join(" &middot; ") + '</div><div class="log" data-log="' + key + '">' + rows + "</div>";
}

/**
 * The panes whose terminal is on screen: each open, live session's worker
 * pane that names a tmux pane. `dashboard.js` polls exactly these.
 */
export function terminalPanes(rows, open) {
  return [...new Set(
    rows
      .filter((s) => open.has(sessionKey(s)) && !s.merged && s.status !== "failed" && paneHref(paneOf(s)))
      .map(paneOf),
  )];
}

/**
 * A live session's terminal: its worker pane's screen as ringo renders it
 * (escaped text in styled spans, so it goes in as HTML), polled by
 * `dashboard.js` through the same relay as `/panes/:id`. `screen` is that
 * loop's last `{ html, notice, bad }`, or nothing before its first answer.
 * `data-log` keeps its scroll, and its following, through a repaint.
 */
export function terminalHtml(pane, screen) {
  const notice = screen ? screen.notice : "connecting…";
  return (
    '<div class="terminal-head"><h4>Terminal <code>' + esc(pane) + "</code></h4>" +
    '<span class="pane-notice' + (screen && screen.bad ? " bad" : "") + '" data-terminal-notice="' + esc(pane) + '" role="status">' + esc(notice) + "</span></div>" +
    '<pre class="terminal" tabindex="0" data-terminal="' + esc(pane) + '" data-log="term-' + esc(pane) + '" aria-label="Pane ' + esc(pane) + ' screen">' +
    (screen && screen.html ? screen.html : "") + "</pre>"
  );
}

// ---------------------------------------------------------------------------
// One session
// ---------------------------------------------------------------------------

const PR_URL = (s) => "https://github.com/" + s.owner + "/" + s.repo + "/pull/" + s.pr;

const storyLink = (story, cls) =>
  '<a class="' + cls + '" href="/story/' + encodeURIComponent(story.id) + '" title="' + esc(story.id) + '">' + esc(story.title || story.id) + "</a>";

/**
 * The expanded card: the session log, a message box, and the controls and
 * facts the collapsed one leaves out. A live session shows its terminal, with
 * the log beneath it as a short strip of events: stage changes, PR events and
 * what the operator sent.
 */
export function sessionDetail(s, ctx, lead) {
  const key = sessionKey(s);
  const live = !!paneOf(s) && !s.merged && s.status !== "failed";
  const composer = live
    ? '<div class="composer"><textarea class="ctl" rows="2" id="compose-' + key + '" data-keep="compose-' + key +
      '" aria-label="Message the agent" placeholder="Message the agent… (⌘↵ sends)"></textarea>' +
      '<button class="btn btn-sm" data-action="pane-send" data-pane="' + esc(paneOf(s)) + '" data-key="' + key +
      '" data-source="compose-' + key + '" data-clears="compose-' + key + '" data-says="compose-note-' + key + '">Send</button>' +
      '<span class="field-status" id="compose-note-' + key + '"></span></div>'
    : "";
  const facts = [];
  if (lead && lead.rfc) facts.push(["RFC", '<a href="/rfc/' + encodeURIComponent(lead.rfc) + '">' + esc(lead.rfc) + "</a>"]);
  if (s.branch) facts.push(["Branch", "<code>" + esc(s.branch) + "</code>"]);
  if (isPR(s)) {
    facts.push(["PR", '<a href="' + PR_URL(s) + '" target="_blank">#' + s.pr + "</a> " + (s.merged ? "merged" : s.draft ? "draft" : "open")]);
    facts.push(["Review", plural(s.reviewCycles || 0, "cycle") + " &middot; " + plural(s.openFindings || 0, "open finding")]);
    if (CI_TITLES[s.ciStatus]) facts.push(["CI", CI_TITLES[s.ciStatus]]);
  }
  const panes = isPR(s) ? workerLine(s) + reviewerLine(s, ctx.reviewers) : paneLine(WORK_EMOJI, s.pane, s.pane_status, s.pane_input);
  const href = paneHref(paneOf(s));
  const side =
    '<dl class="kv">' + facts.map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("") + "</dl>" +
    (panes ? '<div class="panes">' + panes + "</div>" : "") +
    (isPR(s) ? cleanupControl(s, ctx.now) : "") +
    (href ? '<a class="btn btn-sm" href="' + href + '">Open pane</a>' : "");
  const queued = isPR(s) ? queuedUnder(s, ctx.queue, "") : "";
  return (
    '<div class="detail" id="' + key + '-detail">' +
    '<div class="detail-log">' + (live && href ? terminalHtml(paneOf(s), ctx.screens && ctx.screens.get(paneOf(s))) + '<h4>Events</h4><div class="events">' + logHtml(s, ctx) + "</div>" : "<h4>Session log</h4>" + logHtml(s, ctx)) + composer + "</div>" +
    '<div class="detail-side">' + side + queued + "</div>" +
    "</div>"
  );
}

/**
 * One session row: PR link and flags, the lead story and the bundle's other
 * stories, a note, the stepper, and one progress figure over how long ago it
 * changed; then its question or stall strip, and its details when expanded.
 */
export function sessionCard(s, ctx, fixer = null) {
  if (s.kind) return '<article class="session session-drafting grooming">' + rfcSpawnRow(s, ctx.now) + "</article>";
  const key = sessionKey(s);
  const stage = stageOf(s, ctx);
  const failed = !isPR(s) && s.status === "failed";
  const { lead, rest } = sessionStories(s, ctx.stories);
  const open = !!(ctx.open && ctx.open.has(key));
  const ask = askFor(s, ctx.asks);
  const stall = ask ? null : sessionStall(s, ctx);
  const needs = sessionNeeds(s, ctx, fixer);

  const tags =
    (isPR(s)
      ? '<a class="pr-link" href="' + PR_URL(s) + '" target="_blank">' + esc(s.repo) + "#" + s.pr + "</a>"
      : '<span class="pr-link none">no PR yet</span>') +
    (fixer ? '<span class="flag kind">CI fixer</span><span class="flag bad">main is red</span>' : "") +
    (isPR(s) && s.ciStatus === "failure" ? '<span class="flag bad check-failed">check failed</span>' : "") +
    (s.mergeConflict ? '<span class="conflict">conflict</span>' : "") +
    (s.labels || []).map((l) => '<span class="label">' + esc(l) + "</span>").join("") +
    (failed ? '<span class="status status-failed">failed</span>' : paneOverridePill(paneStatusOf(s)) || "");

  const fallback = s.title || (isPR(s) ? s.owner + "/" + s.repo + "#" + s.pr : s.story_id);
  const leadHtml = lead
    ? storyLink(lead, "story lead")
    : isPR(s)
      ? '<a class="story lead" href="' + PR_URL(s) + '" target="_blank">' + esc(fallback) + "</a>"
      : s.story_id
        ? '<a class="story lead" href="/story/' + encodeURIComponent(s.story_id) + '">' + esc(fallback) + "</a>"
        : '<span class="story lead">' + esc(fallback) + "</span>";
  const stories = '<div class="stories">' + leadHtml + rest.map((story) => storyLink(story, "story")).join("") + "</div>";

  const note = [];
  if (fixer) note.push(fixerNote(fixer));
  else if (s.lastAction) note.push(esc(s.lastAction));
  if (!isPR(s) && s.source && !fixer) note.push("spawned via " + esc(s.source));
  if (failed && s.error) note.push('<span class="bad">' + esc(s.error) + "</span>");

  const ring = stage === "ringo" ? reviewRing(s, ctx.reviewers ? ctx.reviewers[reviewerKey(s.owner, s.repo, s.pr)] : null) : "";
  const figure = stageFigure(s, stage);
  const when = isPR(s) ? s.lastTime : s.at;
  const meta =
    '<div class="meta">' +
    (stage === "ready"
      ? control("merge", { owner: s.owner, repo: s.repo, pr: s.pr }, { cls: "btn btn-sm", title: "Merge PR", label: "Merge" })
      : '<span class="figure">' + figure + "</span>") +
    (failed && s.branch
      ? control("dismiss", { branch: s.branch }, { cls: "spawn-dismiss", title: "Dismiss this failed spawn", label: "&times;" })
      : "") +
    '<button type="button" class="expand" data-ui="expand" data-key="' + key + '" aria-expanded="' + open + '" aria-controls="' + key +
    '-detail" aria-label="Session details for ' + esc(lead ? lead.id : fallback) + '">' + (when ? timeAgo(when, ctx.now) : "details") + "</button>" +
    "</div>";

  return (
    '<article class="session session-' + stage + (fixer ? " fixer" : "") + (needs ? " needs" : "") + (open ? " open" : "") +
    (failed ? " failed" : "") + '" id="' + key + '"' + (fixer ? ' data-fixer="' + fixerAnchor(fixer.owner + "/" + fixer.repo) + '"' : "") + ">" +
    '<div class="session-main list-grid" data-ui="row" data-key="' + key + '">' +
    '<div class="session-info"><div class="tags">' + tags + "</div>" + stories +
    (note.length ? '<div class="session-note">' + note.join(" &middot; ") + "</div>" : "") + "</div>" +
    '<div class="session-stage">' + stepper(stage, ring) +
    '<span class="now-label">' + stageName(stage) + (figure && stage !== "ready" ? '<span class="muted"> · ' + figure + "</span>" : "") + "</span></div>" +
    meta +
    "</div>" +
    (ask ? askStrip(ask, ctx.now) : "") +
    (stall ? stallStrip(s, stall) : "") +
    (open ? sessionDetail(s, ctx, lead) : "") +
    "</article>"
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

const STAGE_ORDER = Object.fromEntries(STAGES.map(([id], i) => [id, i]));

/**
 * One repo's rows in order: the CI fixer first whatever its stage, then by
 * stage, Drafting first, ties kept in ringo's order; grooming agents last.
 */
export function orderSessions(rows, ctx, fixerByKey = new Map()) {
  const rank = (s) => (s.kind ? STAGES.length + 1 : fixerByKey.has(sessionKey(s)) ? -1 : STAGE_ORDER[stageOf(s, ctx)]);
  return rows
    .map((s, at) => ({ s, at, rank: rank(s) }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map(({ s }) => s);
}

/** The merged sessions folded into one line at the end of a repo's list, each expandable. */
export function mergedLine(merged, ctx) {
  if (!merged.length) return "";
  const entries = merged
    .map((s) => {
      const { lead } = sessionStories(s, ctx.stories);
      const key = sessionKey(s);
      return (
        '<span class="merged-entry"><a class="mono" href="' + PR_URL(s) + '" target="_blank">' + esc(s.repo) + "#" + s.pr + "</a> " +
        (lead ? storyLink(lead, "story") : esc(s.title || "")) +
        (s.lastTime ? ' <span class="muted">' + timeAgo(s.lastTime, ctx.now) + "</span>" : "") +
        ' <button type="button" class="expand" data-ui="expand" data-key="' + key + '" aria-expanded="' + !!(ctx.open && ctx.open.has(key)) +
        '" aria-label="Session details for #' + s.pr + '">log</button></span>'
      );
    })
    .join("");
  const opened = merged.filter((s) => ctx.open && ctx.open.has(sessionKey(s))).map((s) => sessionCard(s, ctx)).join("");
  return '<div class="merged-line"><b>Merged · ' + merged.length + "</b>" + entries + "</div>" + opened;
}

/** The repo groups of one frame, each with its ordered active rows, its merged ones and its fixer map. */
export function sessionGroups(sections) {
  return sections.map((section) => {
    const all = [...section.spawns, ...section.prs];
    return { name: section.name, rows: all.filter((s) => !s.merged), merged: section.prs.filter((s) => s.merged) };
  });
}

/**
 * The whole list: questions no row matches, then each repo as one surface of
 * rows divided by hairlines, ending with its Merged line. Returns the markup
 * and the counts the filter chips show.
 */
export function sessionList(sections, ctx, extras = {}) {
  const { byKey, orphans } = joinFixers(ctx.fixers, sections.flatMap((s) => s.prs), sections.flatMap((s) => s.spawns));
  const groups = sessionGroups(sections);
  for (const orphan of orphans) {
    const group = groups.find((g) => g.name === orphan.repo);
    if (group) group.rows.unshift(orphan);
    else groups.push({ name: orphan.repo, rows: [orphan], merged: [] });
  }
  const rows = groups.flatMap((g) => g.rows);
  const asks = unmatchedAsks(ctx.asks, rows);
  let active = 0;
  let needs = asks.length;
  const html =
    asks.map((a) => askRow(a, ctx.now)).join("") +
    groups
      .map((g) => {
        const ordered = orderSessions(g.rows, ctx, byKey);
        const cards = ordered.map((s) => {
          const fixer = byKey.get(sessionKey(s)) || null;
          if (!s.kind) active++;
          if (sessionNeeds(s, ctx, fixer)) needs++;
          return sessionCard(s, ctx, fixer);
        });
        const anyNeeds = ordered.some((s) => sessionNeeds(s, ctx, byKey.get(sessionKey(s)) || null));
        const live = ordered.filter((s) => !s.kind).length;
        return (
          '<section class="repo' + (anyNeeds ? " has-needs" : "") + '" aria-label="' + esc(g.name) + '">' +
          '<div class="repo-head"><h2>' + esc(g.name) + '</h2><span class="muted">' + live + " active</span>" + (extras[g.name] || "") + "</div>" +
          '<div class="sessions">' +
          (cards.length ? cards.join("") : '<div class="list-empty">No open sessions.</div>') +
          mergedLine(g.merged, ctx) +
          "</div></section>"
        );
      })
      .join("");
  return { html, active, needs, rows: [...rows, ...groups.flatMap((g) => g.merged)], fixerByKey: byKey };
}

/** The filter chips' text, with their counts. */
export function filterChips(active, needs, filter) {
  const chip = (f, label) =>
    '<button type="button" class="chip" data-ui="filter" data-filter="' + f + '" aria-pressed="' + (filter === f) + '">' + label + "</button>";
  return chip("all", "All " + active) + chip("needs", "Needs you " + needs);
}

/** `?filter=needs` opens the page filtered; anything else is All. */
export const filterFrom = (search) => (new URLSearchParams(search || "").get("filter") === "needs" ? "needs" : "all");

/** The location with its filter set, for `history.replaceState`. */
export function filterUrl(href, filter) {
  const url = new URL(href);
  if (filter === "needs") url.searchParams.set("filter", "needs");
  else url.searchParams.delete("filter");
  return url.pathname + url.search + url.hash;
}

