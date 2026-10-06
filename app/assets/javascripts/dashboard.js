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
  controlOutcome,
  controlRequest,
  fixerCards,
  fixerSummary,
  mainCIByRepo,
  mainCITitle,
  prRow,
  reconnectDelay,
  pullFailLabel,
  pullFailTitle,
  repoSectionScaffold,
  repoSections,
  repoSectionsKey,
  sectionId,
  spawnRow,
  visibleSpawns,
} from "./fleet-format.js";

const config = document.getElementById("fleetConfig");
const socketPath = (config && config.dataset.socketPath) || "/fleet/socket";
const controlPath = (config && config.dataset.controlPath) || "/fleet/control";

/**
 * Where a control POST goes: trailmap, which forwards it to ringo. `path` is
 * ringo's own (`/merge-pr`), so the buttons keep naming what they do there.
 */
function ringoUrl(path) {
  return controlPath + path;
}

/** The page's CSRF token, which every control POST has to carry. */
function csrfHeaders() {
  const token = config && config.dataset.csrfToken;
  return token ? { "X-CSRF-Token": token } : {};
}

const byId = (id) => document.getElementById(id);

function setDot(id, on) {
  byId(id).className = "connected " + (on ? "on" : "off");
}

let fixers = [];

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
      ? section.prs.map((pr) => prRow(pr, fixers)).join("")
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
      '<span class="ico">\u{1F3D7}\uFE0F</span><span class="label"></span>';
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
      pill.querySelector(".ico").textContent = a.icon || "\u{1F3BC}";
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
  const prs = envelope.prs || [];

  fixers = envelope.fixers || [];
  renderCIFixer(fixers);
  renderRepoSections(prs, visibleSpawns(prs, envelope.spawns || []));

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
// Row controls -- merge, dismiss, clear failed, respawn fixer. One listener for
// all of them: the rows are redrawn on every frame, so a listener bound to a
// button would be bound to a node that is gone a second later.
// ---------------------------------------------------------------------------

document.addEventListener("click", async (event) => {
  const button = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
  if (!button || button.disabled) return;
  const request = controlRequest(button.dataset.action, button.dataset);
  if (!request) return;
  if (request.confirm && !window.confirm(request.confirm)) return;

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

  // Everything the button does next is decided in `controlOutcome`, where it
  // is tested; this only applies it.
  const outcome = controlOutcome(request, result, label);
  button.disabled = outcome.disabled;
  if (outcome.text !== undefined) button.textContent = outcome.text;
  if (outcome.title !== undefined) button.title = outcome.title;
  if (outcome.alert) window.alert(outcome.alert);
  if (outcome.resetAfterMs) {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = label;
    }, outcome.resetAfterMs);
  }
});
