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
 * already hold — every frame repaints from the envelope, as ringo's does.
 */
import {
  activeFixers,
  fixerCards,
  fixerSummary,
  mainCIByRepo,
  mainCITitle,
  prRow,
  pullFailLabel,
  pullFailTitle,
  repoSections,
  sectionId,
  spawnRow,
  visibleSpawns,
} from "./fleet-format.js";

const config = document.getElementById("fleetConfig");
const eventsUrl = (config && config.dataset.eventsUrl) || "/events";

/**
 * Where a control POST goes. The SSE URL names ringo's origin, so the one verb
 * this page offers (spawn) is addressed relative to the SAME origin rather
 * than to trailmap, which does not implement it.
 */
function ringoUrl(path) {
  try {
    return new URL(path, new URL(eventsUrl, window.location.href)).toString();
  } catch (e) {
    return path;
  }
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
  const wanted = sections.map((s) => s.name).join(" ");
  if (host.dataset.repos !== wanted) {
    host.innerHTML = sections
      .map(({ name }) => {
        const id = sectionId(name);
        return (
          '<h2 class="repo-heading">' + name.replace(/[&<>]/g, "") + "</h2>" +
          '<div class="listbox" id="' + id + '-spawnsSection" style="display:none">' +
          '<div id="' + id + '-spawns"></div></div>' +
          '<div class="listbox"><div id="' + id + '-prs"></div></div>'
        );
      })
      .join("");
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

const source = new EventSource(eventsUrl, { withCredentials: true });

source.onmessage = (event) => {
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
};

source.onopen = () => {
  setDot("eventsDot", true);
  byId("eventsPill").classList.add("ok");
};

source.onerror = () => {
  setDot("eventsDot", false);
  byId("eventsPill").classList.remove("ok");
};

// ---------------------------------------------------------------------------
// Manual spawn — the one control this page carries, and the reason the repo
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
      credentials: "include",
      headers: { "Content-Type": "application/json" },
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
