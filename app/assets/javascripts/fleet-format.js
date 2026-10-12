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

export function statusClass(next) {
  return "status status-" + String(next || "").toLowerCase().replace(/\s+/g, "-");
}

/*
 * The pane status dot: green working, yellow waiting on an answer, red API
 * error, purple half-circle out of quota, muted ring idle. The limit dot is its own GLYPH
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

export function paneDot(status) {
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
export function paneLine(label, pane, status, lead = "") {
  if (!pane) return "";
  const role = label === WORK_EMOJI ? "worker" : "reviewer";
  const href = paneHref(pane);
  const id = "<code>" + esc(pane) + "</code>";
  return (
    '<div class="pcell"><span class="plabel" title="' + role + '">' + label + "</span>" +
    '<span class="pval">' + lead +
    (href ? '<a class="pane-link" href="' + href + '" title="watch this pane live">' + id + "</a>" : id) +
    paneDot(status) + "</span></div>"
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
 * The reviewer row of a PR's pane mini-table, right below the worker's.
 *
 * Three states, all of them worth a row: a reviewer with a live pane (agent,
 * pane id, status dot -- the same shape as the worker's line, linked to the
 * same live view), a reviewer pinned to a PR whose pane has gone (the agent
 * and a dash, because the assignment outlives the pane), and no reviewer at
 * all (a dash). ringo offers a `+` in the last two; this page is read-only and
 * offers none, but it still says which of the three it is -- "nobody is
 * reviewing this" is the thing a reader most wants to see.
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
  if (entry && entry.pane_id) return paneLine(REV_EMOJI, entry.pane_id, entry.pane_status, chip);
  return (
    '<div class="pcell unassigned"><span class="plabel" title="reviewer">' + REV_EMOJI + "</span>" +
    '<span class="pval">' + chip + '<span class="dash">—</span></span></div>'
  );
}

export const FIXER_BADGE =
  '<span class="label label-fixer" title="Auto-filed fixer for a red main">fixer</span>';

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

export function fixerSummary(list) {
  if (list.some((f) => f.paused)) return "spawn loop paused — waiting on main to recover";
  return list.length === 1 ? "main is red" : list.length + " repos red";
}

/** One card per red repo. */
export function fixerCards(list) {
  return list
    .map((f) => {
      const repo = f.owner + "/" + f.repo;
      const phase = fixerPhase(f);
      const rows = [];

      let head =
        '<span class="fixer-repo-name">' + esc(repo) + "</span>" +
        '<span class="fixer-phase ' + phase + '">' + phase + "</span>";
      if ((f.consecutive_red || 0) > 1) {
        head += '<span class="fixer-meta">' + f.consecutive_red + "&times; consecutive red</span>";
      }
      rows.push('<div class="fixer-line">' + head + "</div>");

      if ((f.checks && f.checks.length) || f.red_sha) {
        let line = '<span class="fixer-meta">red:</span> ';
        if (f.checks && f.checks.length) {
          line += '<span class="fixer-checks">' + f.checks.map(esc).join(", ") + "</span>";
        }
        if (f.red_sha) {
          const sha = "<code>" + esc(f.red_sha.slice(0, 8)) + "</code>";
          line += f.red_url ? ' <a href="' + esc(f.red_url) + '" target="_blank">' + sha + "</a>" : " " + sha;
        }
        rows.push('<div class="fixer-line">' + line + "</div>");
      }

      const links = [];
      if (f.story_id) {
        links.push('<a href="/story/' + encodeURIComponent(f.story_id) + '"><code>' + esc(f.story_id) + "</code></a>");
      }
      if (f.pr) {
        links.push('<a href="https://github.com/' + esc(repo) + "/pull/" + f.pr + '" target="_blank">#' + f.pr + "</a>");
      }
      if (links.length) {
        rows.push('<div class="fixer-line"><span class="fixer-meta">fixer:</span> ' + links.join(" ") + "</div>");
      }

      if (f.awaiting_rebase && f.awaiting_rebase.length) {
        const prs = f.awaiting_rebase
          .map((n) => '<a href="https://github.com/' + esc(repo) + "/pull/" + n + '" target="_blank">#' + n + "</a>")
          .join(" ");
        rows.push('<div class="fixer-line"><span class="fixer-meta">awaiting rebase:</span> ' + prs + "</div>");
      }
      // The manual lever for a wedged coordinator: a fixer that finished
      // unseen dedupes away every replacement, leaving a red main with no
      // worker on it. Offered only while a red is actually recorded.
      if (f.red_sha) {
        rows.push(
          '<div class="fixer-line">' +
            control("respawn-fixer", { owner: f.owner, repo: f.repo }, {
              cls: "btn btn-sm",
              title: "Discard the tracked fixer story and spawn a fresh worker for this red",
              label: f.story_id ? "respawn fixer" : "spawn fixer",
            }) +
            "</div>",
        );
      }
      return '<div class="fixer-repo">' + rows.join("") + "</div>";
    })
    .join("");
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
export function controlRequest(action, data) {
  const repo = data.owner + "/" + data.repo;
  switch (action) {
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
        path: "/spawnloop/spawn-now",
        body: null,
        busy: "spawning…",
        done: "spawning…",
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
    case "clear-failed":
      return { path: "/spawnloop/dismiss-failed", body: null, quiet: true };
    default:
      return null;
  }
}

/** A JSON answer, or `{}` for one that is not: ringo's errors are plain text. */
function parsed(text) {
  try { return JSON.parse(text) || {}; } catch { return {}; }
}

const plural = (n, noun) => n + " " + noun + (n === 1 ? "" : "s");

/**
 * What the button shows once its request has settled. `result` is
 * `{ ok, text }` for an answered request and `{ error }` for one that never
 * got an answer; `label` is what the button said before the click.
 *
 * Returns `{ disabled, text?, title?, alert?, resetAfterMs?, refresh? }`. A
 * missing `text` leaves the button's text alone; `refresh` names the read to
 * poll again, because an answered control changed what it reports.
 *
 * Four families, as in ringo, with two of its holes closed:
 *
 * - merge keeps the button disabled for the full reset period on EVERY
 *   outcome, a failed fetch included, then restores it.
 * - respawn stays disabled on success (the card redraws) and comes straight
 *   back on any failure.
 * - the quiet controls stay disabled on success, because the next frame
 *   removes the row or hides the button. On a refusal or a failed fetch they
 *   come back. ringo leaves them disabled there, and since the row only goes
 *   away on success, that is a dead button with nothing to say why.
 * - the loop's settings never stay disabled: the control is still there after
 *   the click, and a success carries the loop's new `state` for the page to
 *   draw. "spawn now" is the exception, held like merge and then re-read
 *   (`refresh`), because ringo answers before the tick has registered.
 */
export function controlOutcome(request, result, label) {
  const answered = !("error" in result);
  // A 200 is not always a yes: `accepted` reads the body of one that says no.
  const succeeded = answered && result.ok && (!request.accepted || request.accepted(result.text));
  const outcome = { disabled: succeeded || (!request.quiet && !!request.resetAfterMs) };
  if (answered && request.refresh) outcome.refresh = request.refresh;
  if (request.quiet) return outcome;
  if (request.state) return succeeded ? stateOutcome(result.text) : { disabled: false };

  const said = answered ? result.text : result.error;
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

// ---------------------------------------------------------------------------
// The spawn loop's settings panel
// ---------------------------------------------------------------------------

/** The panel's buttons, drawn once; `spawnLoopView` says what each shows. */
export const spawnLoopControls = () =>
  control("loop-toggle", { enabled: "false" }, {
    id: "slToggle", cls: "btn btn-green btn-sm", title: "Start or pause the spawn loop", label: "play",
  }) +
  control("loop-now", {}, {
    cls: "btn btn-blue btn-sm", title: "Run one tick now, bypassing caps", label: "spawn now",
  }) +
  '<span class="field-note" id="slNext"></span>' +
  control("loop-skip", {}, {
    id: "slSkip", cls: "btn btn-sm", title: "Skip the next story", label: "skip", hidden: true,
  });

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
    enabled: !!s.enabled,
    toggle: s.enabled ? "pause" : "play",
    liveCap: s.live_cap,
    queueCap: s.queue_cap,
    interval: Math.round((s.stagger_seconds || 0) / 60),
    bundleMode: !!s.bundle_mode,
    liveNow: "(now: " + (s.live_now || 0) + ")",
    openNow: "(now: " + (s.open_now || 0) + ")",
    lastSpawn: s.last_spawn_at ? "(latest: " + timeAgo(s.last_spawn_at, now) + ")" : "",
    next,
    nextTitle,
    skip: !s.bundle_mode && !!(s.next && s.next.id),
    bundleList: bundle
      .map((story) =>
        '<div class="bl-row"><span class="bl-loc">' + (story.est_loc ? story.est_loc + " LOC" : "—") +
        '</span><span class="bl-title"><a href="/story/' + encodeURIComponent(story.id) +
        '" title="' + esc(story.id) + '">' + esc(story.title || story.id) + "</a></span></div>")
      .join(""),
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/*
 * GitHub octicons, inlined so a PR, spawn or merged row shows the same status
 * circle the backlog list does. Fill comes from `.ricon svg` in the shell CSS.
 */
export const ICONS = {
  issue: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"></path><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"></path></svg>',
  pr: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"></path></svg>',
  merge: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"></path></svg>',
};

/*
 * The CI rollup for ONE PR, shown right after its title: green check, red x,
 * yellow dot. A different signal from the main-CI pills in the status group,
 * which are about a repo's default branch -- this one says whether the checks
 * on this pull request are passing, and it is the only place the page says so.
 * Fill comes from the `.ci-<status>` rules.
 */
const CI_ICONS = {
  success: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z"></path></svg>',
  failure: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z"></path></svg>',
  pending: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"></circle></svg>',
};

const CI_TITLES = { success: "CI passing", failure: "CI failing", pending: "CI running" };

/** '' for a PR whose checks have not reported, rather than a neutral glyph. */
export function ciIcon(status) {
  if (!status || !CI_ICONS[status]) return "";
  return '<span class="ci-icon ci-' + status + '" title="' + CI_TITLES[status] + '">' + CI_ICONS[status] + "</span>";
}

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
function paneOverridePill(paneStatus) {
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
    panes: paneLine(WORK_EMOJI, s.pane, s.pane_status),
    cls: " spawn",
  });
}

/** One pre-PR worker, as a GitHub-issue-style list row. */
export function spawnRow(s, fixers = [], now = Date.now()) {
  if (s.kind) return rfcSpawnRow(s, now);
  const failed = s.status === "failed";

  // A failed spawn says only that. Nothing overrides it: the pane is gone, so
  // its last status is stale, and "waiting for PR" would be a lie.
  let label;
  if (failed) {
    label = '<span class="status status-failed">failed</span>';
  } else {
    label =
      paneOverridePill(s.pane_status) ||
      '<span class="status status-spawned">spawned</span> <span class="' +
        statusClass("waiting for PR") + '">waiting for PR</span>';
  }

  const url = "/story/" + encodeURIComponent(s.story_id);
  const meta = ['<a href="' + url + '"><code>' + esc(s.story_id) + "</code></a>"];
  if (s.branch) meta.push("<code>" + esc(s.branch) + "</code>");
  if (s.at) meta.push("spawned " + timeAgo(s.at, now) + (s.source ? " via " + esc(s.source) : ""));
  if (failed && s.error) meta.push('<span style="color:var(--red)">' + esc(s.error) + "</span>");

  return row({
    icon: "issue",
    iconCls: failed ? "failed" : s.pane_status === "waiting" ? "waiting" : "",
    title:
      '<a class="rtitle" href="' + url + '">' + esc(s.title || s.story_id) + "</a>" +
      (isFixerStory(fixers, s.story_id) ? " " + FIXER_BADGE : "") + label,
    meta: meta.join(" &middot; "),
    aside:
      failed && s.branch
        ? control("dismiss", { branch: s.branch }, {
            cls: "spawn-dismiss",
            title: "Dismiss this failed spawn",
            label: "&times;",
          })
        : "",
    panes: paneLine(WORK_EMOJI, s.pane, s.pane_status),
    cls: " spawn" + (failed ? " failed" : ""),
  });
}

/** One PR row. */
export function prRow(pr, fixers = [], now = Date.now(), reviewers = null, queue = []) {
  const url = "https://github.com/" + pr.owner + "/" + pr.repo + "/pull/" + pr.pr;
  const labels =
    (isFixerPR(fixers, pr) ? FIXER_BADGE + " " : "") +
    (pr.mergeConflict ? '<span class="conflict">conflict</span> ' : "") +
    (pr.labels || []).map((l) => '<span class="label">' + esc(l) + "</span>").join("");
  const statusPill =
    paneOverridePill(pr.paneStatus) ||
    '<span class="' + statusClass(pr.nextAction) + '">' + esc(pr.nextAction || "") + "</span>";

  const meta = ['<a href="' + url + '" target="_blank">#' + pr.pr + "</a>"];
  if (pr.branch) meta.push("<code>" + esc(pr.branch) + "</code>");
  if (pr.commentCount || pr.reviewCycles) {
    meta.push(
      (pr.commentCount || 0) + " comment" + (pr.commentCount === 1 ? "" : "s") +
      " &middot; " + (pr.reviewCycles || 0) + " cycles",
    );
  }
  if (pr.lastAction) meta.push(esc(pr.lastAction));
  if (pr.lastTime) meta.push(timeAgo(pr.lastTime, now));

  // Mirror GitHub's glyphs: git-merge purple once merged, a muted PR icon for
  // a draft, yellow while waiting on an answer, green open otherwise.
  const merged = !!pr.merged;
  const draft = !merged && !!pr.draft;
  return queuedUnder(pr, queue, row({
    icon: merged ? "merge" : "pr",
    iconCls: merged ? "merged" : draft ? "draft" : pr.paneStatus === "waiting" ? "waiting" : "",
    title:
      '<a class="rtitle" href="' + url + '" target="_blank">' +
      esc(pr.title || pr.owner + "/" + pr.repo + "#" + pr.pr) + "</a>" +
      ciIcon(pr.ciStatus) + labels,
    meta: meta.join(" &middot; "),
    // A merged PR lingers while its worker pane tears down; the merged glyph
    // says so and the now-pointless button goes.
    aside:
      statusPill +
      (merged
        ? ""
        : control("merge", { owner: pr.owner, repo: pr.repo, pr: pr.pr }, {
            cls: "act merge",
            title: "Merge PR",
            label: "merge",
          })),
    // The worker's pane, and under it the reviewer's. The merge BUTTON goes
    // when the PR is merged, because the action is gone; the reviewer stays,
    // because it is information -- and who reviewed a PR is most wanted while
    // reading the merge. ringo renders it unconditionally too
    // (`dashboard.go:1335`).
    panes: paneLine(WORK_EMOJI, pr.pane, pr.paneStatus) + reviewerLine(pr, reviewers),
  }));
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

export const askSummary = (pending) => plural(pending.length, "agent") + " blocked, waiting for an answer";

/** A picked option sends its label, under its question when several were asked. */
export function askAnswer(ask, question, label) {
  return (ask.questions || []).length > 1 ? question.question + " → " + label : label;
}

export function askCards(pending, now = Date.now()) {
  return pending
    .map((a) => {
      const questions = (a.questions || [])
        .map((q) => {
          const options = (q.options || [])
            .map((o) =>
              control("answer-ask", { id: a.id, answer: askAnswer(a, q, o.label) }, {
                cls: "ask-opt",
                title: "Answer with this option",
                label: esc(o.label) + (o.description ? '<span class="d">' + esc(o.description) + "</span>" : ""),
              }),
            )
            .join("");
          return (
            '<div class="ask-text">' + (q.header ? '<span class="ask-hdr">' + esc(q.header) + "</span> " : "") +
            esc(q.question) + "</div>" + (options ? '<div class="ask-opts">' + options + "</div>" : "")
          );
        })
        .join("");
      return (
        '<div class="ask-q"><div class="ask-who"><strong>' + esc(a.label) + "</strong>" +
        (a.pane ? "<code>" + esc(a.pane) + "</code>" : "") +
        "<span>" + timeAgo(a.at, now) + "</span></div>" + questions +
        '<div class="ask-free"><input type="text" class="ctl" placeholder="…or answer in your own words">' +
        control("answer-ask", { id: a.id, free: 1 }, { cls: "btn btn-sm", title: "Send your own answer", label: "Send" }) +
        "</div></div>"
      );
    })
    .join("");
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

/** A tick and a two-letter day at each local midnight of the usage week. */
export function dayMarkers(weeklyResets, at, now = Date.now()) {
  const left = hoursUntilReset(weeklyResets, at, now);
  const start = now - (WEEK_HOURS - (left === null ? WEEK_HOURS : left)) * HOUR;
  const midnight = new Date(start);
  midnight.setHours(24, 0, 0, 0);
  const first = (midnight.getTime() - start) / HOUR;
  let out = "";
  for (let d = 0; d < 7 && first + d * 24 < WEEK_HOURS; d++) {
    const day = DAYS[new Date(midnight.getTime() + d * 24 * HOUR).getDay()].slice(0, 2);
    out += '<span class="day-marker" style="left:' + ((first + d * 24) / WEEK_HOURS) * 100 + '%"><span>' + day + "</span></span>";
  }
  return out;
}

/** "42% of week elapsed (1d 3h ahead)": how far usage is from the week's pace. */
export function paceText(elapsed, diff) {
  const hours = Math.round((Math.abs(diff) / 100) * WEEK_HOURS);
  const gap = hours >= 24 ? Math.floor(hours / 24) + "d " + (hours % 24) + "h" : hours + "h";
  return elapsed + "% of week elapsed" + (diff > 0 ? " (" + gap + " ahead)" : diff < 0 ? " (" + gap + " under)" : "");
}

const clamp = (percent) => Math.max(0, Math.min(100, Number(percent) || 0));

/** One labelled bar. `week` is the pace marker and day ticks of a weekly one. */
function usageBar({ label, percent, color, left, right = "", week = "" }) {
  return (
    '<div class="usage-col"><div class="usage-col-label">' + label + "</div>" +
    '<div class="bar-container' + (week ? " week" : "") + '">' +
    '<div class="bar-fill ' + color + '" style="width:' + clamp(percent) + '%"></div>' + week + "</div>" +
    '<div class="bar-label"><span>' + left + "</span>" + right + "</div></div>"
  );
}

const usageHead = (agent, meta) =>
  '<div class="usage-head"><span class="usage-agent">' + agent + '</span><span class="usage-meta">' + esc(meta) + "</span></div>";

function weeklyBar(u, now, right) {
  const elapsed = weekElapsedPercent(u.weeklyResets, u.weeklyResetsAt, now);
  const diff = clamp(u.weeklyPercent) - elapsed;
  return usageBar({
    label: "Weekly (" + esc(formatResetLabel(u.weeklyResets, u.weeklyResetsAt, now)) + ")",
    percent: u.weeklyPercent,
    color: weeklyPaceColor(diff),
    left: clamp(u.weeklyPercent) + "%",
    right: right(elapsed, diff),
    week: '<div class="bar-marker" style="left:' + elapsed + '%"></div>' + dayMarkers(u.weeklyResets, u.weeklyResetsAt, now),
  });
}

function sessionBar(u, now, right) {
  return usageBar({
    label: "Session (" + esc(formatClockLabel(u.sessionResets, u.sessionResetsAt, now)) + ")",
    percent: u.sessionPercent,
    color: barColor(u.sessionPercent),
    left: clamp(u.sessionPercent) + "%",
    right,
  });
}

/** The Claude block, from ringo's `/usage-status` (`renderUsage`). */
export function claudeUsage(u, now = Date.now()) {
  const models = (u.weeklyModels || [])
    .map((m) =>
      usageBar({
        label: esc(m.name) + (m.resets ? " (resets " + esc(formatResetLabel(m.resets, m.resetsAt, now)) + ")" : ""),
        percent: m.percent,
        color: barColor(clamp(m.percent)),
        left: clamp(m.percent) + "%",
      }),
    )
    .join("");
  const money = (n) => "$" + (Number(n) || 0).toFixed(2);
  const balance = Number(u.extraBalance) || 0;
  const extra =
    u.extraLimit > 0 || u.extraBalance > 0
      ? '<div class="usage-extra">Extra usage: ' +
        (u.extraEnabled ? '<span style="color:var(--green)">ON</span>' : "<span>OFF</span>") +
        " &middot; " + money(u.extraSpent) + " spent &middot; " +
        '<span style="color:var(--' + (balance < 2 ? "red" : balance < 5 ? "yellow" : "green") + ')">' +
        money(balance) + " balance</span> &middot; $" + Number(u.extraLimit) + " limit</div>"
      : "";
  return (
    usageHead("Claude", u.lastCheckTime ? "updated " + timeAgo(u.lastCheckTime, now) : "") +
    '<div class="usage-cols">' +
    sessionBar(u, now, u.paused ? '<span style="color:var(--red)">MANUAL PAUSE (' + Number(u.queueSize) + " queued)</span>" : "") +
    '<div class="usage-col">' + models + "</div></div>" +
    weeklyBar(u, now, (elapsed, diff) =>
      '<span style="color:var(--' + (diff > 0 ? "yellow" : "green") + ')">' + paceText(elapsed, diff) + "</span>",
    ) +
    extra
  );
}

/**
 * The Codex block, from `/codex-usage-status` (`renderCodexUsage`). A percent
 * below zero is a window Codex did not report, and that bar goes; with both
 * gone the block says so, and the plan name moves up to the header.
 */
export function codexUsage(u, now = Date.now()) {
  const hasSession = u.sessionPercent >= 0;
  const hasWeekly = u.weeklyPercent >= 0;
  const updated = u.lastUpdated ? "updated " + timeAgo(u.lastUpdated, now) : "";
  const cols =
    (hasSession ? sessionBar(u, now, u.planType ? "<span> &middot; " + esc(u.planType) + "</span>" : "") : "") +
    (hasWeekly ? weeklyBar(u, now, (elapsed) => "<span>" + elapsed + "% of week elapsed</span>") : "");
  return (
    usageHead("Codex", !hasSession && u.planType ? [u.planType, updated].filter(Boolean).join(" · ") : updated) +
    (cols
      ? '<div class="usage-cols">' + cols + "</div>"
      : '<div class="usage-col-label">No limits reported yet — Codex only publishes them while a session is running.</div>')
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** Where a story goes when its RFC names no other repo, and always shown. */
export const DEFAULT_REPO = "blazetrailsdev/trails";

/** Rows have carried owner and repo separately since before there were two. */
export const repoOf = (pr) => (pr.owner ? pr.owner + "/" : "") + (pr.repo || "");

export const sectionId = (name) => "repo-" + name.replace(/[^a-zA-Z0-9]+/g, "-");

/**
 * The scaffolding for one frame's sections: a heading, a spawns box (hidden
 * until that repo has spawns) and a PR box, per repo.
 *
 * Built here rather than in the wiring so it is the LAST piece of markup with
 * no test. It is rebuilt only when the repo set changes, so an ordinary
 * refresh does not blow away scroll position or anything open inside it --
 * which is what `repoSectionsKey` is compared against.
 */
export function repoSectionScaffold(sections) {
  return sections
    .map(({ name }) => {
      const id = sectionId(name);
      return (
        '<h2 class="repo-heading">' + esc(name) +
        (name === DEFAULT_REPO
          ? " " + control("clear-failed", {}, {
              cls: "spawn-dismiss",
              id: CLEAR_FAILED_ID,
              hidden: true,
              title: "Dismiss all failed spawns",
              label: "clear failed",
            })
          : "") +
        "</h2>" +
        '<div class="listbox" id="' + id + '-spawnsSection" style="display:none">' +
        '<div id="' + id + '-spawns"></div></div>' +
        '<div class="listbox"><div id="' + id + '-prs"></div></div>'
      );
    })
    .join("");
}

export const repoSectionsKey = (sections) => sections.map((s) => s.name).join(" ");

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
    (s) => s.kind || (!branches.has(s.branch) && !branches.has(s.story_id) && !(s.pane && panes.has(s.pane))),
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
