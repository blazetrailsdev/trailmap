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
  activeFixers,
  anyFailedSpawn,
  broadcastButtons,
  askCards,
  askSummary,
  claudeUsage,
  codexUsage,
  controlOutcome,
  controlRequest,
  drainStatus,
  fixerCards,
  fixerSummary,
  mainCIByRepo,
  mainCITitle,
  pokeButton,
  prRow,
  queueCard,
  redPanes,
  reconnectDelay,
  pullFailLabel,
  pullFailTitle,
  repoSectionScaffold,
  repoSections,
  repoSectionsKey,
  reviewersPollOutcome,
  sectionId,
  spawnRow,
  strandedAgents,
  visibleSpawns,
} from "./fleet-format.js";

const config = document.getElementById("fleetConfig");
const socketPath = (config && config.dataset.socketPath) || "/fleet/socket";
const controlPath = (config && config.dataset.controlPath) || "/fleet/control";
const reviewersPath = (config && config.dataset.reviewersPath) || "/fleet/reviewers";
const readPath = (config && config.dataset.readPath) || "/fleet/read";

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

let fixers = [];
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

function renderCIFixer(list) {
  const panel = byId("ciFixerPanel");
  const shown = activeFixers(list);
  if (!shown.length) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "";
  panel.classList.toggle("paused", shown.some((f) => f.paused));
  byId("ciFixerSummary").textContent = fixerSummary(shown);
  byId("ciFixerBody").innerHTML = fixerCards(shown);
}

function renderRepoSections(prs, spawns) {
  const host = byId("repoSections");
  const sections = repoSections(prs, spawns);

  // Rebuild the scaffolding only when the repo SET changes, so an ordinary
  // refresh does not blow away scroll position or anything open inside it.
  const wanted = repoSectionsKey(sections);
  if (host.dataset.repos !== wanted) {
    host.innerHTML = repoSectionScaffold(sections);
    host.dataset.repos = wanted;
  }

  sections.forEach((section) => {
    const id = sectionId(section.name);
    byId(id + "-spawnsSection").style.display = section.spawns.length ? "" : "none";
    byId(id + "-spawns").innerHTML = section.spawns.map((s) => spawnRow(s, fixers)).join("");
    byId(id + "-prs").innerHTML = section.prs.length
      ? section.prs.map((pr) => prRow(pr, fixers, Date.now(), reviewers, queue)).join("")
      : '<div class="list-empty">No open PRs.</div>';
  });

  // The heading button outlives the rows (the scaffold is rebuilt only when
  // the repo set changes), so a click's disabled state would outlive them too:
  // hiding it is also what makes it usable for the next failure.
  const clearFailed = byId(CLEAR_FAILED_ID);
  if (clearFailed) {
    const failed = anyFailedSpawn(spawns);
    clearFailed.style.display = failed ? "" : "none";
    if (!failed) clearFailed.disabled = false;
  }
}

function updateMainCI(failures) {
  const host = byId("mainCIPills");
  host.innerHTML = "";
  mainCIByRepo(failures).forEach((group) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.title = mainCITitle(group);
    // Click opens the first failing check's run page, when we have a URL.
    const url = group.items.map((f) => f.url).find(Boolean);
    if (url) {
      pill.style.cursor = "pointer";
      pill.onclick = () => window.open(url, "_blank");
    }
    pill.innerHTML =
      '<span class="connected on" style="background:var(--red)"></span>' +
      '<span class="ico">🏗️</span><span class="label"></span>';
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
      pill.innerHTML = '<span class="connected off"></span><span class="ico"></span><span class="label"></span>';
      pill.querySelector(".ico").textContent = a.icon || "🎼";
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

  fixers = envelope.fixers || [];
  renderCIFixer(fixers);
  renderRepoSections(prs, visibleSpawns(prs, envelope.spawns || []));

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

pollReviewers();
setInterval(pollReviewers, REVIEWERS_POLL_MS);

// Enter sends to everyone; with Ctrl or Cmd, to the CI-red audience.
byId("bcastMsg").addEventListener("keydown", (event) => {
  // Not while an IME is composing: that Enter confirms the composition.
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  byId(event.metaKey || event.ctrlKey ? "bcastCIRed" : "bcastAll").click();
});

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
      const response = await fetch(readPath + "/" + name, { credentials: "same-origin", signal });
      if (response.ok) onAnswer(await response.json());
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
  byId("usageGroup").style.display = "";
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
  queue = u.queue || [];
  byId("queueSection").style.display = queue.length ? "" : "none";
  byId("queueSection").innerHTML = queueCard(queue);
  if (lastEnvelope) paint(lastEnvelope);
}, usageStale("usageBar"));

poll("codex-usage", 60_000, (u) => showUsage("codexUsageBar", codexUsage(u), !!u.stale), usageStale("codexUsageBar"));

// Redrawn only when the questions CHANGE: a repaint erases a half-typed answer.
let asksShown = "";
poll("asks", 5_000, (answer) => {
  const pending = answer.pending || [];
  byId("askPanel").style.display = pending.length ? "" : "none";
  if (asksShown === JSON.stringify(pending)) return;
  asksShown = JSON.stringify(pending);
  byId("askSummary").textContent = askSummary(pending);
  byId("askBody").innerHTML = askCards(pending);
});

// Enter in a free-text answer is its Send button.
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target instanceof Element && event.target.matches(".ask-free input")) {
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
// Manual spawn -- the one control this page carries, and the reason the repo
// list is configuration. It posts to ringo, which owns the spawn loop.
// ---------------------------------------------------------------------------

byId("spawn").addEventListener("click", async () => {
  const button = byId("spawn");
  const status = byId("spawnStatus");
  const task = byId("task");
  const message = task.value.trim();
  if (!message) return;

  button.disabled = true;
  status.textContent = "Spawning...";
  try {
    const response = await fetch(ringoUrl("/spawn"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ repoDir: byId("repo").value, message }),
    });
    const text = await response.text();
    status.textContent = (response.ok ? "Spawned: " : "Error: ") + text;
    if (response.ok) task.value = "";
  } catch (e) {
    status.textContent = "Error: " + e.message;
  }
  button.disabled = false;
});

// ---------------------------------------------------------------------------
// Controls -- every button with a `data-action`. One listener for all of them:
// the rows are redrawn on every frame, so a listener bound to a button would
// be bound to a node that is gone a second later.
// ---------------------------------------------------------------------------

document.addEventListener("click", async (event) => {
  const button = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
  if (!button || button.disabled) return;
  // A free-text answer is whatever is in the input beside its button.
  const data = button.dataset.free ? { ...button.dataset, answer: button.previousElementSibling.value } : button.dataset;
  const request = controlRequest(button.dataset.action, data, {
    nextReviewer,
    audiences,
    message: byId("bcastMsg").value,
  });
  if (!request) return;
  if (request.note) byId("bcastNote").textContent = request.note;
  if (!request.path) return;
  if (request.confirm && !window.confirm(request.confirm)) {
    if (request.note) byId("bcastNote").textContent = "";
    return;
  }

  const label = button.textContent;
  button.disabled = true;
  if (request.busy) button.textContent = request.busy;

  let result;
  try {
    const response = await fetch(ringoUrl(request.path), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        ...csrfHeaders(),
        ...(request.body === null ? {} : { "Content-Type": "application/json" }),
      },
      ...(request.body === null ? {} : { body: JSON.stringify(request.body) }),
    });
    const text = (await response.text()).trim();
    result = { ok: response.ok, text: text || (response.ok ? "" : response.statusText) };
  } catch (e) {
    result = { error: e.message };
  }

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
  if (outcome.alert) window.alert(outcome.alert);
  if (outcome.note !== undefined) byId("bcastNote").textContent = outcome.note;
  if (outcome.clearMessage) byId("bcastMsg").value = "";
  if (outcome.resetAfterMs) {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = label;
    }, outcome.resetAfterMs);
  }
});
