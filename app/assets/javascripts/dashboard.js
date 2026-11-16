/*
 * The fleet dashboard's DOM wiring.
 *
 * Everything that decides what the page SAYS lives in `./fleet-format.js`,
 * where it is tested. What is left here is the part that cannot be: opening
 * the stream, and assigning the strings that module returns onto elements the
 * `.tse` rendered.
 *
 * The envelope is `Tracker.ServeEvents` (`webhook/dashboard.go:2383`),
 * unchanged and still served by Go. Nothing here holds state Go does not
 * already hold -- every frame repaints from the envelope, as ringo's does.
 */
import {
  CLEAR_FAILED_ID,
  DEFAULT_REPO,
  PALETTE_INPUT,
  anyFailedSpawn,
  broadcastButtons,
  claudeUsage,
  control,
  codexUsage,
  controlOutcome,
  controlRequest,
  drainStatus,
  mainCIByRepo,
  mainCITitle,
  pokeButton,
  queueCard,
  redPanes,
  reconnectDelay,
  pullFailLabel,
  pullFailTitle,
  repoSections,
  reviewersPollOutcome,
  spawnLoopControls,
  spawnLoopView,
  strandedAgents,
  usageScraperPill,
  usageSummary,
  visibleSpawns,
} from "./fleet-format.js";
import {
  fixerAnchor,
  frameEvents,
  frameRows,
  sessionKey,
  sessionList,
  storiesQuery,
  terminalPanes,
  trackPanes,
} from "./fleet-sessions.js";
import { atBottom, noticeText, screenUrl } from "./pane-format.js";
import { createPaneLoop, paintScreen } from "./pane-loop.js";
import {
  paletteActions,
  paletteFlat,
  paletteGroups,
  paletteHtml,
  paletteMove,
  palettePrs,
  paletteSessions,
  paletteStories,
  repoName,
  scopeChips,
} from "./fleet-palette.js";

const config = document.getElementById("fleetConfig");
const socketPath = (config && config.dataset.socketPath) || "/fleet/socket";
const controlPath = (config && config.dataset.controlPath) || "/fleet/control";
const reviewersPath = (config && config.dataset.reviewersPath) || "/fleet/reviewers";
const readPath = (config && config.dataset.readPath) || "/fleet/read";
const storiesPath = (config && config.dataset.storiesPath) || "/fleet/stories";
const transcriptPath = (config && config.dataset.transcriptPath) || "/fleet/transcript";

/**
 * Where a control POST goes: trailmap, which forwards it to ringo. `path` is
 * ringo's own (`/merge-pr`), so the buttons keep naming what they do there.
 */
function ringoUrl(path) {
  return controlPath + path;
}

/**
 * The page's CSRF token, which every control POST has to carry. From the
 * layout's `csrf_meta_tags`, where Rails' own scripts read it.
 */
function csrfHeaders() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? { "X-CSRF-Token": meta.content } : {};
}

const byId = (id) => document.getElementById(id);

function setDot(id, on) {
  byId(id).className = "connected " + (on ? "on" : "off");
}

/**
 * ringo's reviewer list, keyed `owner/repo#pr`, or NULL for "no answer yet".
 *
 * Null until the first poll lands, and null for as long as every poll fails.
 * The rows render no reviewer line at all while it is null -- see
 * `reviewerLine`. An empty MAP is a different statement: ringo answered, and
 * nobody is reviewing anything.
 */
let reviewers = null;
/** The last envelope, so a reviewer answer can repaint without waiting for a frame. */
let lastEnvelope = null;
/** The notifications ringo's usage gate is holding, from the usage poll. */
let queue = [];

/*
 * The session list's state beyond the envelope (RFC 0232): what the page has
 * read from trailmap's own data, and what it has recorded since it loaded.
 * All of it is the page's, for the page's life; a reload starts it again.
 */
const ctx = {
  now: Date.now(),
  fixers: [],
  reviewers: null,
  queue: [],
  stories: {},
  asks: [],
  panes: new Map(),
  open: new Set(),
  log: new Map(),
  steps: new Map(),
  screens: new Map(),
  since: new Date().toISOString(),
};
/** The last frame's rows by key, so the next frame can say what changed. */
let lastRows = null;
/** The rows the palette searches: the last frame's sessions, and its PRs. */
let shownRows = [];
let shownPrs = [];

/** Record what changed between frames into each session's log. */
function record(rows) {
  for (const event of frameEvents(lastRows, rows, ctx)) {
    if (!ctx.log.has(event.key)) ctx.log.set(event.key, []);
    ctx.log.get(event.key).push(event);
  }
  lastRows = frameRows(rows, ctx);
}

/*
 * Every repaint replaces the list's markup, so what the viewer is in the
 * middle of -- a half-typed answer or message, the field with the cursor, a
 * log's scroll -- is read off before and put back after.
 */
function keepWhileRepainting(host, paint) {
  const kept = [...host.querySelectorAll("[data-keep]")].map((el) => [el.dataset.keep, el.value]);
  const focused = document.activeElement && host.contains(document.activeElement) ? document.activeElement.dataset.keep : null;
  const selection = focused ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  const scrolls = [...host.querySelectorAll("[data-log]")].map((el) => [el.dataset.log, el.scrollTop, el.scrollHeight - el.scrollTop - el.clientHeight < 4]);
  paint();
  for (const [key, value] of kept) {
    const el = host.querySelector('[data-keep="' + CSS.escape(key) + '"]');
    if (el) el.value = value;
  }
  if (focused) {
    const el = host.querySelector('[data-keep="' + CSS.escape(focused) + '"]');
    if (el) {
      el.focus();
      if (selection && el.setSelectionRange) el.setSelectionRange(selection[0], selection[1]);
    }
  }
  for (const el of host.querySelectorAll("[data-log]")) {
    const was = scrolls.find(([key]) => key === el.dataset.log);
    // A log opens at its newest entry, and stays there while it is followed.
    el.scrollTop = !was || was[2] ? el.scrollHeight : was[1];
  }
}

// ---------------------------------------------------------------------------
// An expanded live session's terminal: its worker pane, polled through the
// same screen relay and loop as `/panes/:id`, one loop per pane on screen.
// ---------------------------------------------------------------------------

const terminals = new Map();

async function fetchScreen(pane, hash) {
  const path = "/fleet/pane/" + encodeURIComponent(pane.slice(1)) + "/screen";
  try {
    const response = await fetch(screenUrl(path, hash), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return { error: (await response.text()).slice(0, 200) || "HTTP " + response.status, status: response.status };
    return { body: await response.json() };
  } catch (error) {
    return { error: error && error.message ? error.message : String(error) };
  }
}

/**
 * Put a loop's answer on the page without repainting the list: the screen
 * into its `<pre>`, the notice beside it, and both into `ctx.screens` so the
 * next repaint draws them again.
 */
function paintTerminal(pane, loop, html) {
  if (terminals.get(pane) !== loop) return;
  const was = ctx.screens.get(pane);
  const notice = noticeText(loop.state, { paused: false });
  const screen = { html: html !== null ? html : was ? was.html : "", notice, bad: !!(loop.state.exited || loop.state.unreachable) };
  ctx.screens.set(pane, screen);
  const pre = document.querySelector('[data-terminal="' + CSS.escape(pane) + '"]');
  if (pre && html !== null) paintScreen(pre, html, atBottom);
  const note = document.querySelector('[data-terminal-notice="' + CSS.escape(pane) + '"]');
  if (note) {
    note.textContent = notice;
    note.classList.toggle("bad", screen.bad);
  }
}

/** Start a loop for each terminal now on screen, and stop the rest. */
function syncTerminals() {
  const want = new Set(terminalPanes(shownRows, ctx.open));
  for (const [pane, loop] of terminals) {
    if (want.has(pane)) continue;
    loop.stop();
    terminals.delete(pane);
    ctx.screens.delete(pane);
  }
  for (const pane of want) {
    if (terminals.has(pane)) continue;
    const loop = createPaneLoop({
      fetchScreen: (hash) => fetchScreen(pane, hash),
      hidden: () => document.hidden,
      paint: (html) => paintTerminal(pane, loop, html),
    });
    terminals.set(pane, loop);
    loop.start();
  }
}

document.addEventListener("visibilitychange", () => {
  for (const loop of terminals.values()) loop.pollNow();
});

function renderSessions(prs, spawns) {
  ctx.now = Date.now();
  const host = byId("repoSections");
  const sections = repoSections(prs, spawns);
  const clearFailed = control("clear-failed", {}, {
    cls: "spawn-dismiss", id: CLEAR_FAILED_ID, hidden: !anyFailedSpawn(spawns), title: "Dismiss all failed spawns", label: "clear failed",
  });
  const list = sessionList(sections, ctx, { [DEFAULT_REPO]: clearFailed });
  shownRows = list.rows;
  shownPrs = prs;
  keepWhileRepainting(host, () => {
    host.innerHTML = list.html;
  });
  syncTerminals();
  return list.rows;
}

function updateMainCI(failures) {
  const host = byId("mainCIPills");
  host.innerHTML = "";
  mainCIByRepo(failures).forEach((group) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.title = mainCITitle(group);
    // A click goes to the repo's CI fixer row when there is one, else
    // opens the first failing check's run page, when we have a URL.
    const url = group.items.map((f) => f.url).find(Boolean);
    const fixerRow = document.querySelector('[data-fixer="' + fixerAnchor(group.repo.includes("/") ? group.repo : "") + '"]') ||
      [...document.querySelectorAll("[data-fixer]")].find((el) => el.dataset.fixer.endsWith("-" + group.repo.replace(/[^a-zA-Z0-9_-]+/g, "-")));
    if (fixerRow || url) {
      pill.style.cursor = "pointer";
      pill.onclick = () => (fixerRow ? fixerRow.scrollIntoView({ block: "center" }) : window.open(url, "_blank"));
    }
    pill.innerHTML =
      '<span class="connected on" style="background:var(--red)"></span>' +
      '<span class="label"></span>';
    pill.querySelector(".label").textContent = group.repo + " CI: " + group.items.length;
    host.appendChild(pill);
  });
}

function updatePullFail(failures) {
  const pill = byId("pullFailPill");
  if (!failures || !failures.length) {
    pill.style.display = "none";
    return;
  }
  pill.style.display = "";
  const dot = byId("pullFailDot");
  dot.className = "connected on";
  dot.style.background = "var(--red)";
  byId("pullFailLabel").textContent = pullFailLabel(failures);
  pill.title = pullFailTitle(failures);
}

/** One pill per configured long-lived agent, built once and updated in place. */
function updateAgents(agents) {
  const host = byId("agentPills");
  (agents || []).forEach((a) => {
    const detected = !!(a.state || {}).detected;
    let pill = byId("agentPill-" + a.name);
    if (!pill) {
      pill = document.createElement("span");
      pill.className = "pill";
      pill.id = "agentPill-" + a.name;
      pill.innerHTML = '<span class="connected off"></span><span class="label"></span>';
      pill.querySelector(".label").textContent = a.name;
      host.appendChild(pill);
    }
    pill.querySelector(".connected").className = "connected " + (detected ? "on" : "off");
    pill.classList.toggle("ok", detected);
    pill.title = detected ? a.name + " pane (" + (a.dir || "") + ")" : "no " + a.name + " pane";
  });
}

// ---------------------------------------------------------------------------
// The stream
// ---------------------------------------------------------------------------

/*
 * A WebSocket to trailmap, which relays ringo's stream (`FleetController`).
 * Unlike the EventSource this replaced, a WebSocket does not reconnect itself,
 * so this does: at once after a socket that was delivering frames, backing off
 * to thirty seconds otherwise. A trailmap deploy or a ringo restart both look
 * like a dropped socket.
 */
function onFrame(event) {
  const data = JSON.parse(event.data);
  // ringo's stream still supports the legacy bare-array frame; so does this.
  const envelope = Array.isArray(data) ? { prs: data } : data;
  lastEnvelope = envelope;
  paint(envelope);
}

function paint(envelope) {
  const prs = envelope.prs || [];
  const spawns = visibleSpawns(prs, envelope.spawns || []);

  ctx.fixers = envelope.fixers || [];
  ctx.reviewers = reviewers;
  ctx.panes = trackPanes(ctx.panes, prs, spawns, Date.now());
  const rows = renderSessions(prs, spawns);
  record(rows);

  // A button that is mid-request keeps what it says until it is reset.
  const poke = pokeButton(redPanes(prs, envelope.spawns, reviewers));
  const pokeBtn = byId("pokeBtn");
  pokeBtn.style.display = poke.hidden ? "none" : "";
  pokeBtn.dataset.panes = poke.panes;
  if (!pokeBtn.disabled) pokeBtn.textContent = poke.label;
  const stranded = strandedAgents(reviewers);
  byId("drainCodexField").style.display = stranded.codex ? "" : "none";
  byId("drainClaudeField").style.display = stranded.claude ? "" : "none";

  setDot("tmuxDot", !!envelope.tmuxConnected);
  byId("tmuxPill").classList.toggle("ok", !!envelope.tmuxConnected);
  updateMainCI(envelope.mainCIFailures);
  updatePullFail(envelope.pullFailures);
  updateAgents(envelope.agents);
}

function setConnected(on) {
  setDot("eventsDot", on);
  byId("eventsPill").classList.toggle("ok", on);
}

function connect(attempt) {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(scheme + "//" + window.location.host + socketPath);
  // The backoff resets on the first FRAME, not on open: with ringo down,
  // trailmap accepts the socket and closes it at once, and resetting on open
  // would turn that into a reconnect loop with no delay in it.
  let received = false;
  socket.onopen = () => setConnected(true);
  socket.onmessage = (event) => {
    received = true;
    onFrame(event);
  };
  socket.onclose = () => {
    setConnected(false);
    const next = received ? 0 : attempt + 1;
    setTimeout(() => connect(next), reconnectDelay(next));
  };
}

connect(0);

// ---------------------------------------------------------------------------
// The reviewer list
// ---------------------------------------------------------------------------

/*
 * Who is reviewing each open PR is not in the event envelope -- ringo's own
 * dashboard fetches it separately too -- so the reviewer row of every PR's
 * pane mini-table comes from here, on a timer rather than the stream. A failed
 * poll keeps the last answer: a reviewer is a long-lived assignment, and
 * blanking the rows because one request lost its race says something false.
 *
 * ringo's own interval (`dashboard.go:2425`), and no faster. A reviewer
 * changes when a pane is spawned or dies, not between frames, and trailmap is
 * a hop ringo's page does not have: it relays once per viewer, so polling
 * harder would multiply that hop for nothing.
 */
const REVIEWERS_POLL_MS = 30_000;

/*
 * The poll's state between ticks: the last answer, and whether the last poll
 * worked. What a settled poll does to it -- keep or replace the answer, warn
 * or stay quiet -- is `reviewersPollOutcome`'s decision, tested there. What is
 * left here is carrying it out.
 */
let reviewerPoll = { reviewers, ok: true };

function reviewersSettled(result) {
  reviewerPoll = reviewersPollOutcome(result, reviewerPoll);
  reviewers = reviewerPoll.reviewers;
  if ("warn" in reviewerPoll) console.warn("fleet: the reviewer list is stale --", reviewerPoll.warn);
  // Repaint from the last frame, so the reviewer rows appear on a cold load
  // without waiting for the next one (the race ringo's own page notes).
  if (reviewerPoll.ok && lastEnvelope) paint(lastEnvelope);
}

/*
 * Whether a poll is in flight. `setInterval` does not wait for the last one,
 * and the browser's `fetch` has no timeout of its own -- the relay's 5s budget
 * is the SERVER's patience, and a hung trailmap would leave the request open
 * in the tab regardless. Without this, every tick of a stuck poll would stack
 * another connection on a page that already holds a socket per viewer.
 */
let reviewersInFlight = false;

async function pollReviewers() {
  if (reviewersInFlight) return;
  reviewersInFlight = true;
  try {
    const response = await fetch(reviewersPath, {
      credentials: "same-origin",
      // The browser's own deadline, a poll interval wide: the tab gives up
      // before the next tick rather than holding a dead request forever.
      signal: AbortSignal.timeout(REVIEWERS_POLL_MS),
    });
    // The relay answers a failure with ringo's own status and text, so the
    // body is read as text there: it is the reason itself, not a guess at one.
    const body = response.ok ? await response.json() : await response.text();
    reviewersSettled({ ok: response.ok, status: response.status, body });
  } catch (error) {
    reviewersSettled({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    reviewersInFlight = false;
  }
}

/*
 * The two other things the page reads beside the stream, on the same timer:
 * which agent a `+` spawns as a reviewer, and each broadcast audience's size.
 * A failed read keeps the last answer. Until one lands the agent is unknown
 * and is not guessed: ringo's page assumes `copilot` (`dashboard.go:814`),
 * which would assign the wrong reviewer whenever the loop is set to another.
 */
let nextReviewer = "";
let audiences = {};

/*
 * Each session's bundle stories, and a spawn's reported stage, from the tasks
 * database: one request on the reviewer poll's cadence for every PR and spawn
 * in the last frame. A failed read keeps the last answer; a story attributed
 * after its PR opened shows on the next poll.
 */
let storiesInFlight = false;

async function pollStories() {
  if (storiesInFlight || !lastEnvelope) return;
  const query = storiesQuery(lastEnvelope.prs || [], lastEnvelope.spawns || []);
  if (!query) return;
  storiesInFlight = true;
  try {
    const response = await fetch(storiesPath + "?" + query, { credentials: "same-origin", signal: AbortSignal.timeout(REVIEWERS_POLL_MS) });
    if (response.ok) {
      ctx.stories = await response.json();
      paint(lastEnvelope);
    }
  } catch {
    // The last answer stands.
  } finally {
    storiesInFlight = false;
  }
}

pollReviewers();
setInterval(() => {
  pollReviewers();
  pollStories();
}, REVIEWERS_POLL_MS);
// The first frame names the PRs to ask about; ask as soon as it has.
const firstStories = setInterval(() => {
  if (!lastEnvelope) return;
  clearInterval(firstStories);
  pollStories();
}, 250);

// ---------------------------------------------------------------------------
// Usage and relayed questions -- polled, as ringo's own page fetches them.
// ---------------------------------------------------------------------------

/** By name, so a control that changed what one reports can re-run it. */
const polls = {};

function poll(name, everyMs, onAnswer, onFailure = () => {}) {
  let inFlight = false;
  polls[name] = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const signal = AbortSignal.timeout(everyMs);
      const started = performance.now();
      const response = await fetch(readPath + "/" + name, { credentials: "same-origin", signal });
      if (response.ok) onAnswer(await response.json(), started);
      else onFailure();
    } catch {
      onFailure();
    } finally {
      inFlight = false;
    }
  };
  polls[name]();
  setInterval(polls[name], everyMs);
}

// The reviewer list answers to a control's `refresh` by the same name.
polls.reviewers = pollReviewers;
poll("reviewer-config", REVIEWERS_POLL_MS, (cfg) => {
  nextReviewer = cfg.next_reviewer || nextReviewer;
});
poll("broadcast-targets", REVIEWERS_POLL_MS, (counts) => {
  audiences = counts;
  const shown = broadcastButtons(audiences);
  byId("bcastAll").textContent = shown.all.text;
  byId("bcastAll").classList.toggle("dim", shown.all.dim);
  byId("bcastCIRed").textContent = shown.ciRed.text;
  byId("bcastCIRed").style.display = shown.ciRed.hidden ? "none" : "";
});

function showUsage(id, html, stale) {
  const block = byId(id);
  block.style.display = "";
  block.classList.toggle("stale", stale);
  block.innerHTML = html;
}

/*
 * A failed poll marks what is already drawn stale, so old numbers do not pass
 * for current ones. A block that has never been drawn stays hidden: ringo
 * shows an empty Codex shell there, but the only thing to put in it would be
 * a statement about Codex, and what failed was the relay.
 */
const usageStale = (id) => () => byId(id).classList.add("stale");

poll("usage", 60_000, (u) => {
  showUsage("usageBar", claudeUsage(u), !!u.stale);
  byId("usageSummary").textContent = usageSummary(u);
  const pill = usageScraperPill(u);
  byId("watchPill").style.display = "";
  byId("watchDot").className = "connected " + pill.state;
  byId("watchPill").classList.toggle("ok", pill.state === "on");
  byId("watchPill").title = pill.title;
  queue = u.queue || [];
  byId("queueSection").style.display = queue.length ? "" : "none";
  byId("queueSection").innerHTML = queueCard(queue);
  if (lastEnvelope) paint(lastEnvelope);
}, usageStale("usageBar"));

poll("codex-usage", 60_000, (u) => showUsage("codexUsageBar", codexUsage(u), !!u.stale), usageStale("codexUsageBar"));

// Each question is drawn in its session's row, so a change repaints the list.
let asksShown = "";
poll("asks", 5_000, (answer) => {
  const pending = answer.pending || [];
  if (asksShown === JSON.stringify(pending)) return;
  asksShown = JSON.stringify(pending);
  ctx.asks = pending;
  if (lastEnvelope) paint(lastEnvelope);
});

// Enter in a free-text answer is its Send button; ⌘↵ in a message box is its.
document.addEventListener("keydown", (event) => {
  if (!(event.target instanceof Element) || event.isComposing) return;
  if (event.key === "Enter" && event.target.matches(".ask-free input")) {
    event.target.nextElementSibling.click();
  } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && event.target.matches(".composer textarea")) {
    event.preventDefault();
    event.target.nextElementSibling.click();
  }
});

/*
 * A drain is a gh round trip and a pane teardown per reviewer, so minutes; ten
 * of them is a drain that is not going to say it has finished.
 */
const DRAIN_POLLS_MAX = 600;

/** A reviewer drain runs in ringo's background; this follows its progress. */
async function followDrain(request, result) {
  const status = byId(request.statusId);
  if (!result.ok) {
    status.textContent = "error" in result ? "error" : "failed";
    return;
  }
  try {
    let d = JSON.parse(result.text);
    for (let polled = 0; ; polled++) {
      status.textContent = drainStatus(d);
      if (!d.running) break;
      if (polled === DRAIN_POLLS_MAX) {
        status.textContent += " (stopped watching)";
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const signal = AbortSignal.timeout(REVIEWERS_POLL_MS);
      const response = await fetch(readPath + "/" + request.poll, { credentials: "same-origin", signal });
      if (!response.ok) break;
      d = await response.json();
    }
    pollReviewers();
  } catch {
    status.textContent = "error";
  }
}

// ---------------------------------------------------------------------------
// Controls -- every button with a `data-action`. One listener for all of them:
// the rows are redrawn on every frame, so a listener bound to a button would
// be bound to a node that is gone a second later.
// ---------------------------------------------------------------------------

/** POST one control to ringo: `{ ok, text }`, or `{ error }` if nothing answered. */
async function send(request) {
  try {
    const response = await fetch(request.url || ringoUrl(request.path), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        ...csrfHeaders(),
        ...(request.body === null ? {} : { "Content-Type": "application/json" }),
      },
      ...(request.body === null ? {} : { body: JSON.stringify(request.body) }),
    });
    const text = (await response.text()).trim();
    return { ok: response.ok, text: text || (response.ok ? "" : response.statusText) };
  } catch (e) {
    return { error: e.message };
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
  if (!button || button.disabled) return;
  // A free-text answer is whatever is in the input beside its button, and a
  // message is whatever is in the box its button names.
  let data = button.dataset.free ? { ...button.dataset, answer: button.previousElementSibling.value } : button.dataset;
  if (button.dataset.source) data = { ...button.dataset, text: byId(button.dataset.source).value };
  const request = controlRequest(button.dataset.action, data, {
    nextReviewer,
    audiences,
    message: byId(PALETTE_INPUT).value,
    task: byId(PALETTE_INPUT).value,
    repoDir: byId("repo").value,
  });
  if (!request) return;
  if (request.focus) return byId(request.focus).focus();
  if (request.note) byId("bcastNote").textContent = request.note;
  if (!request.path) return;
  if (request.confirm && !window.confirm(request.confirm)) {
    if (request.note) byId("bcastNote").textContent = "";
    return;
  }

  const label = button.textContent;
  button.disabled = true;
  if (request.busy) button.textContent = request.busy;
  if (request.saying) byId(request.says).textContent = request.saying;
  const held = (request.holds || []).map(byId).filter((other) => other !== button);
  for (const other of held) other.disabled = true;

  const result = await send(request);
  for (const other of held) other.disabled = false;

  if (request.statusId) {
    await followDrain(request, result);
    button.disabled = false;
    return;
  }

  // Everything the button does next is decided in `controlOutcome`, where it
  // is tested; this only applies it.
  const outcome = controlOutcome(request, result, label);
  // A beat first: ringo has answered, but its next status is what is wanted.
  if (outcome.refresh) setTimeout(polls[outcome.refresh], 1000);
  button.disabled = outcome.disabled;
  if (outcome.text !== undefined) button.textContent = outcome.text;
  if (outcome.title !== undefined) button.title = outcome.title;
  if (outcome.state) loopWritten(outcome.state);
  if (outcome.alert) window.alert(outcome.alert);
  if (outcome.note !== undefined) byId("bcastNote").textContent = outcome.note;
  if (outcome.say !== undefined) byId(request.says).textContent = outcome.say;
  if (outcome.clear) byId(outcome.clear).value = "";
  if (outcome.clearMessage) byId(PALETTE_INPUT).value = "";
  // The palette is about to go, and its report with it: say it on the page.
  if (outcome.closePalette) {
    byId("paletteDone").textContent = outcome.say ?? outcome.note ?? "";
    closePalette();
  }
  if (outcome.sent) {
    // What this page typed into a session goes in that session's log.
    const key = outcome.sent.key || "";
    if (!ctx.log.has(key)) ctx.log.set(key, []);
    ctx.log.get(key).push({ key, at: new Date().toISOString(), kind: "you", text: outcome.sent.text });
    if (lastEnvelope) paint(lastEnvelope);
  }
  if (outcome.resetAfterMs) {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = label;
    }, outcome.resetAfterMs);
  }
});

// ---------------------------------------------------------------------------
// The session list's own controls: expand, a log's earlier steps.
// ---------------------------------------------------------------------------

/** A merged session's transcript, the first page or the one before `before`. */
async function loadSteps(row, before = null) {
  const key = sessionKey(row);
  const params = new URLSearchParams({ owner: row.owner, repo: row.repo, pr: String(row.pr) });
  if (before !== null) params.set("before", String(before));
  const was = ctx.steps.get(key);
  try {
    const response = await fetch(transcriptPath + "?" + params, { credentials: "same-origin", signal: AbortSignal.timeout(REVIEWERS_POLL_MS) });
    if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
    const page = await response.json();
    ctx.steps.set(key, { archives: page.archives, steps: [...page.steps, ...(was && before !== null ? was.steps : [])] });
  } catch (error) {
    ctx.steps.set(key, { archives: 0, steps: was ? was.steps : [], error: "transcript: " + (error instanceof Error ? error.message : String(error)) });
  }
  if (lastEnvelope) paint(lastEnvelope);
}

function toggleSession(key) {
  if (ctx.open.has(key)) ctx.open.delete(key);
  else ctx.open.add(key);
  // A merged session's archive is complete; a live one's is not written yet
  // (RFC 0232 open question 2), so only a merged one reads its transcript.
  const row = shownRows.find((s) => sessionKey(s) === key);
  if (ctx.open.has(key) && row && row.merged && row.pr != null && !ctx.steps.has(key)) loadSteps(row);
  if (lastEnvelope) paint(lastEnvelope);
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const ui = target.closest("[data-ui]");
  if (!ui) return;
  switch (ui.dataset.ui) {
    case "expand":
      event.stopPropagation();
      toggleSession(ui.dataset.key);
      break;
    // The expand button is the control; a click anywhere else on the row is a
    // pointer shortcut to it, so no interactive element sits inside another.
    case "row":
      if (!target.closest("a, button, input, textarea, select")) toggleSession(ui.dataset.key);
      break;
    case "log-earlier": {
      const row = shownRows.find((s) => sessionKey(s) === ui.dataset.key);
      if (row) loadSteps(row, Number(ui.dataset.before));
      break;
    }
    default:
      break;
  }
});

// A log scrolled to its top loads the steps before it.
document.addEventListener(
  "scroll",
  (event) => {
    const log = event.target instanceof Element && event.target.matches("[data-log]") ? event.target : null;
    if (!log || log.scrollTop > 0) return;
    const more = log.parentElement.querySelector('[data-ui="log-earlier"]');
    if (more && !more.disabled) {
      more.disabled = true;
      more.click();
    }
  },
  true,
);

// ---------------------------------------------------------------------------
// The ⌘K palette
// ---------------------------------------------------------------------------

const palette = byId("palette");
const paletteInput = byId(PALETTE_INPUT);
const PALETTE_LABELS = {
  search: "Search sessions, stories and PRs",
  broadcast: "Message to broadcast to the agents",
  spawn: "Describe the task for a new session",
  message: "Message to type into the session's pane",
};
let paletteMode = "search";
let paletteScope = { kind: "all", repo: "" };
let paletteSelected = 0;
let paletteStoryHits = [];
let paletteQuery = 0;
let paletteShown = [];

function paletteResults() {
  const query = paletteInput.value;
  const sessions = paletteSessions(shownRows, ctx, query);
  return [...sessions, ...paletteStories(paletteStoryHits), ...palettePrs(shownPrs, ctx, query), ...paletteActions(query, sessions[0], audiences)];
}

function renderPalette() {
  const searching = paletteMode === "search";
  byId("paletteResults").hidden = !searching;
  byId("paletteScopes").hidden = !searching;
  byId("paletteMode").hidden = searching;
  paletteInput.setAttribute("aria-label", PALETTE_LABELS[paletteMode]);
  paletteInput.placeholder = PALETTE_LABELS[paletteMode];
  for (const pane of palette.querySelectorAll("[data-pane-mode]")) pane.hidden = pane.dataset.paneMode !== paletteMode;
  if (!searching) return;
  const results = paletteResults();
  const repos = [...new Set(shownRows.filter((s) => !s.kind).map(repoName))];
  byId("paletteScopes").innerHTML = scopeChips(results, paletteScope, repos);
  const groups = paletteGroups(results, paletteScope);
  paletteShown = paletteFlat(groups);
  paletteSelected = paletteMove(paletteSelected, paletteShown.length, "");
  byId("paletteResults").innerHTML = paletteHtml(groups, paletteSelected, paletteInput.value);
  paletteInput.setAttribute("aria-activedescendant", paletteShown.length ? "palette-opt-" + paletteSelected : "");
  const on = byId("palette-opt-" + paletteSelected);
  if (on) on.scrollIntoView({ block: "nearest" });
}

/** Open the palette in a mode: search, or one of the actions that replaced the forms. */
function openPalette(mode, extra = {}) {
  paletteMode = mode;
  if (mode === "message") {
    byId("messageSend").dataset.pane = extra.pane;
    byId("messageSend").dataset.key = extra.key;
    byId("paletteModeLabel").textContent = "Message " + extra.title;
    byId("messageNote").textContent = "";
  } else if (mode === "broadcast") {
    byId("paletteModeLabel").textContent = "Broadcast";
  } else if (mode === "spawn") {
    byId("paletteModeLabel").textContent = "Spawn a session";
  }
  byId("paletteDone").textContent = "";
  if (!palette.open) palette.showModal();
  renderPalette();
  paletteInput.focus();
}

function closePalette() {
  if (palette.open) palette.close();
}

/** Do what a result says: open it, or switch to its action. */
function pick(result, withMeta) {
  if (!result) return;
  if (result.kind === "session") {
    if (withMeta && result.pane) {
      paletteInput.value = "";
      return openPalette("message", result);
    }
    closePalette();
    if (!ctx.open.has(result.key)) toggleSession(result.key);
    const el = byId(result.key);
    if (el) el.scrollIntoView({ block: "center" });
  } else if (result.kind === "action") {
    if (result.action === "message") {
      paletteInput.value = "";
      return openPalette("message", result);
    }
    if (result.action === "spawn") return openPalette("spawn");
    if (result.action === "broadcast") {
      openPalette("broadcast");
      if (result.target === "ci-red") byId("bcastCIRed").focus();
    }
  } else if (result.href) {
    closePalette();
    if (result.kind === "pr") window.open(result.href, "_blank");
    else window.location.href = result.href;
  }
}

/** Stories come from the server: asked for a beat after the typing stops, and only the last answer counts. */
let storySearch = 0;
paletteInput.addEventListener("input", () => {
  if (paletteMode !== "search") return;
  paletteSelected = 0;
  renderPalette();
  clearTimeout(storySearch);
  const asked = ++paletteQuery;
  const query = paletteInput.value.trim();
  if (query.length < 2) {
    paletteStoryHits = [];
    return renderPalette();
  }
  storySearch = setTimeout(async () => {
    try {
      const response = await fetch(storiesPath + "?" + new URLSearchParams({ q: query }), { credentials: "same-origin", signal: AbortSignal.timeout(10_000) });
      if (!response.ok || asked !== paletteQuery) return;
      paletteStoryHits = await response.json();
      renderPalette();
    } catch {
      // The browser-side results stand alone.
    }
  }, 150);
});

paletteInput.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (paletteMode === "search" && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    paletteSelected = paletteMove(paletteSelected, paletteShown.length, event.key);
    renderPalette();
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (paletteMode === "search") pick(paletteShown[paletteSelected], event.metaKey || event.ctrlKey);
    // Enter sends to everyone; with Ctrl or Cmd, to the CI-red audience.
    else if (paletteMode === "broadcast") byId(event.metaKey || event.ctrlKey ? "bcastCIRed" : "bcastAll").click();
    else if (paletteMode === "spawn") byId("spawn").click();
    else if (paletteMode === "message") byId("messageSend").click();
  }
});

palette.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  // A click on the backdrop is a click on the dialog itself.
  if (target === palette) return closePalette();
  const ui = target && target.closest("[data-ui]");
  if (!ui) return;
  if (ui.dataset.ui === "palette-pick") pick(paletteShown[Number(ui.dataset.index)], event.metaKey || event.ctrlKey);
  else if (ui.dataset.ui === "palette-close") closePalette();
  else if (ui.dataset.ui === "palette-back") {
    paletteMode = "search";
    renderPalette();
    paletteInput.focus();
  } else if (ui.dataset.ui === "palette-scope") {
    paletteScope = ui.dataset.repo
      ? { kind: paletteScope.kind, repo: paletteScope.repo === ui.dataset.repo ? "" : ui.dataset.repo }
      : { kind: ui.dataset.kind, repo: ui.dataset.kind === "all" ? "" : paletteScope.repo };
    paletteSelected = 0;
    renderPalette();
    paletteInput.focus();
  }
});

document.addEventListener("click", (event) => {
  const opener = event.target instanceof Element ? event.target.closest('[data-ui="palette-open"]') : null;
  if (!opener) return;
  event.preventDefault();
  openPalette(opener.dataset.mode || "search");
});
// The header field is a way into the palette: typing into it types there.
// Not on focus: closing the dialog hands focus back to this field, and a
// focus handler would reopen the palette at once, so Esc and Cancel never close it.
byId("fleetSearch").addEventListener("keydown", (event) => {
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "Enter" || event.key.length === 1) {
    event.preventDefault();
    carryIntoPalette(event.key === "Enter" || event.key === " " ? "" : event.key);
  }
});
// A paste into the field is a paste into the palette.
byId("fleetSearch").addEventListener("paste", (event) => {
  event.preventDefault();
  carryIntoPalette(event.clipboardData ? event.clipboardData.getData("text") : "");
});

/** Open search with `text` added to its box, and search for it as typing would. */
function carryIntoPalette(text) {
  openPalette("search");
  if (!text) return;
  paletteInput.value += text;
  paletteInput.dispatchEvent(new Event("input"));
}

// ⌘K, or Ctrl+K, opens search: the page's only keyboard shortcut.
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (palette.open && paletteMode === "search") closePalette();
    else openPalette("search");
  }
});

// ---------------------------------------------------------------------------
// The shell: Usage and Loop folding on a phone.
// ---------------------------------------------------------------------------

/*
 * Usage and Loop are always open on a wide page, their summary out of the tab
 * order, and fold to that summary line below 700px, opening on tap. Crossing
 * 700px either way puts both back.
 */
const wide = window.matchMedia("(min-width: 701px)");
function syncFolds() {
  for (const fold of document.querySelectorAll("details.fold")) {
    fold.open = wide.matches;
    fold.querySelector("summary").tabIndex = wide.matches ? -1 : 0;
  }
}
syncFolds();
wide.addEventListener("change", syncFolds);
for (const fold of document.querySelectorAll("details.fold")) {
  fold.querySelector("summary").addEventListener("click", (event) => {
    if (wide.matches) event.preventDefault();
  });
}

// The spawn loop's settings. ringo keeps the state; the panel shows its last
// answer, and every control's answer IS the new state.

/** When a control last answered with the loop's state: a poll older than it is stale. */
let loopWrittenAt = 0;

function renderSpawnLoop(state) {
  const view = spawnLoopView(state);
  const toggle = byId("slToggle");
  toggle.disabled = false;
  toggle.title = "Start or pause the spawn loop";
  toggle.textContent = view.toggle;
  toggle.dataset.enabled = String(view.enabled);
  toggle.classList.toggle("btn-green", !view.enabled);
  toggle.classList.toggle("btn-yellow", view.enabled);
  // A field being edited is the viewer's, not the poll's.
  for (const [id, value] of [["slLiveCap", view.liveCap], ["slQueueCap", view.queueCap], ["slStagger", view.interval]]) {
    if (document.activeElement !== byId(id)) byId(id).value = value;
  }
  if (document.activeElement !== byId("slBundle")) byId("slBundle").checked = view.bundleMode;
  for (const [id, text] of [["slLiveNow", view.liveNow], ["slOpenNow", view.openNow], ["slLastSpawn", view.lastSpawn], ["slNext", view.next]]) {
    byId(id).textContent = text;
  }
  byId("slNext").title = view.nextTitle;
  byId("slSkip").style.display = view.skip ? "" : "none";
  byId("slBundleList").innerHTML = view.bundleList;
  byId("slBundleFold").style.display = view.bundleList ? "" : "none";
  byId("loopSummary").textContent = view.enabled ? view.next : "paused";
}

const loopWritten = (state) => ((loopWrittenAt = performance.now()), renderSpawnLoop(state));

byId("slControls").innerHTML = spawnLoopControls();
// Until ringo has said whether the loop runs, a click cannot know which way to toggle.
byId("slToggle").disabled = true;
byId("spawnLoopPanel").addEventListener("change", async (event) => {
  const request = controlRequest("loop-settings", {
    liveCap: byId("slLiveCap").value, queueCap: byId("slQueueCap").value,
    interval: byId("slStagger").value, bundle: byId("slBundle").checked,
  });
  const outcome = controlOutcome(request, await send(request), "");
  if (outcome.state) loopWritten(outcome.state);
  if (outcome.alert) {
    window.alert(outcome.alert);
    // Unfocused, the field takes ringo's value back on the re-read.
    event.target.blur();
    polls["spawn-loop"]();
  }
});
poll("spawn-loop", 15000, (state, started) => {
  if (started >= loopWrittenAt) renderSpawnLoop(state);
}, () => {
  if (byId("slToggle").disabled) byId("slToggle").title = "ringo has not answered for the loop's state yet";
});
