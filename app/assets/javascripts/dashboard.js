/*
 * The fleet dashboard's client half.
 *
 * A port of the render functions inside ringo's constant dashboard HTML
 * (`webhook/dashboard.go:515-2306`), reduced to the sections this page shows:
 * PRs by repo, panes, agents, spawns, CI-fixer cards, main-CI failures and
 * pull failures. The envelope it reads is `Tracker.ServeEvents`
 * (`dashboard.go:2383`), unchanged and still served by Go.
 *
 * Nothing here holds state that Go does not already hold: every frame repaints
 * from the envelope, exactly as ringo's does.
 */

const config = document.getElementById("fleetConfig");
const eventsUrl = (config && config.dataset.eventsUrl) || "/events";

/**
 * Where a control POST goes. The SSE URL names ringo's origin, so a verb this
 * page offers (spawn) is addressed relative to the SAME origin rather than to
 * trailmap, which does not implement it.
 */
function ringoUrl(path) {
  try {
    return new URL(path, new URL(eventsUrl, window.location.href)).toString();
  } catch (e) {
    return path;
  }
}

/** Escape into text/attribute context — every string below is server-authored. */
function esc(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

function statusClass(next) {
  return "status status-" + String(next || "").toLowerCase().replace(/\s+/g, "-");
}

/*
 * The pane status dot: green working, yellow waiting on an answer, red API
 * error, purple ◑ out of quota, muted ○ idle. The limit dot is its own GLYPH
 * as well as its own colour — an exhausted agent looks idle in every other
 * way, and a dot that differed only by hue would be missed in a column of
 * them. Colours come from the shell's tokens rather than ringo's literals.
 */
const PANE_DOTS = {
  working: ["var(--green)", "●", "working"],
  waiting: ["var(--yellow)", "●", "waiting for an answer"],
  error: ["var(--red)", "●", "API error (5xx / stuck retry)"],
  limit: ["var(--purple)", "◑", "hit its session/usage limit"],
};

function paneDot(status) {
  const [color, glyph, title] = PANE_DOTS[status] || ["var(--muted)", "○", "idle"];
  return ' <span style="color:' + color + '" title="' + title + '">' + glyph + "</span>";
}

const WORK_EMOJI = "💪";

/** One row of the compact pane mini-table; '' when there is no pane. */
function paneLine(label, pane, status) {
  if (!pane) return "";
  return (
    '<div class="pcell"><span class="plabel">' + label + "</span>" +
    '<span class="pval"><code>' + esc(pane) + "</code>" + paneDot(status) + "</span></div>"
  );
}

let fixers = [];
const isFixerStory = (id) => !!id && fixers.some((f) => f.story_id === id);
const isFixerPR = (pr) =>
  fixers.some((f) => f.pr && f.pr === pr.pr && f.owner === pr.owner && f.repo === pr.repo);
const FIXER_BADGE =
  '<span class="label label-fixer" title="Auto-filed fixer for a red main">fixer</span>';

// ---------------------------------------------------------------------------
// CI fixer
// ---------------------------------------------------------------------------

/**
 * One card per red repo, with ringo's four phases. `paused` is the one that
 * matters most: it means the spawn loop has stopped because main is red, so
 * the card takes a red left edge instead of the fixer's yellow.
 */
function renderCIFixer(list) {
  const panel = document.getElementById("ciFixerPanel");
  const shown = (list || []).filter(
    (f) => f.story_id || f.paused || f.recovering || (f.consecutive_red || 0) > 0,
  );
  if (!shown.length) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "";
  const anyPaused = shown.some((f) => f.paused);
  panel.classList.toggle("paused", anyPaused);
  document.getElementById("ciFixerSummary").textContent = anyPaused
    ? "spawn loop paused — waiting on main to recover"
    : shown.length === 1
      ? "main is red"
      : shown.length + " repos red";

  document.getElementById("ciFixerBody").innerHTML = shown
    .map((f) => {
      const repo = f.owner + "/" + f.repo;
      const phase = f.recovering ? "recovering" : f.paused ? "paused" : f.story_id ? "fixing" : "red";
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
          line += f.red_url
            ? ' <a href="' + esc(f.red_url) + '" target="_blank">' + sha + "</a>"
            : " " + sha;
        }
        rows.push('<div class="fixer-line">' + line + "</div>");
      }

      const links = [];
      if (f.story_id) {
        links.push(
          '<a href="/story/' + encodeURIComponent(f.story_id) + '"><code>' + esc(f.story_id) + "</code></a>",
        );
      }
      if (f.pr) {
        links.push(
          '<a href="https://github.com/' + esc(repo) + "/pull/" + f.pr + '" target="_blank">#' + f.pr + "</a>",
        );
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
      return '<div class="fixer-repo">' + rows.join("") + "</div>";
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Repo sections: spawns above PRs, one heading per repo
// ---------------------------------------------------------------------------

/** Where a story goes when its RFC names no other repo, and always shown. */
const DEFAULT_REPO = "blazetrailsdev/trails";

const repoOf = (pr) => (pr.owner ? pr.owner + "/" : "") + (pr.repo || "");
const sectionId = (name) => "repo-" + name.replace(/[^a-zA-Z0-9]+/g, "-");

/** One live grooming agent (RFC refine / sunset): links an RFC, never a PR. */
function rfcSpawnRow(s) {
  const verb = s.kind === "rfc-sunset" ? "sunsetting" : "refining";
  const url = "/rfc/" + encodeURIComponent(s.story_id);
  let label = '<span class="' + statusClass(verb) + '">' + verb + "</span>";
  if (s.pane_status === "limit") {
    label = '<span class="' + statusClass("limit reached") + '">limit reached</span>';
  } else if (s.pane_status === "waiting") {
    label = '<span class="' + statusClass("waiting for answer") + '">waiting for answer</span>';
  }
  const meta = ['<a href="' + url + '"><code>' + esc(s.story_id) + "</code></a>"];
  if (s.at) meta.push("spawned " + timeAgo(s.at) + (s.source ? " via " + esc(s.source) : ""));
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
function spawnRow(s) {
  if (s.kind) return rfcSpawnRow(s);
  const failed = s.status === "failed";
  let label = failed
    ? '<span class="status status-failed">failed</span>'
    : '<span class="status status-spawned">spawned</span>';
  if (!failed && s.pane_status === "limit") {
    label = '<span class="' + statusClass("limit reached") + '">limit reached</span>';
  } else if (!failed && s.pane_status === "waiting") {
    label = '<span class="' + statusClass("waiting for answer") + '">waiting for answer</span>';
  } else if (!failed) {
    label += ' <span class="' + statusClass("waiting for PR") + '">waiting for PR</span>';
  }
  const url = "/story/" + encodeURIComponent(s.story_id);
  const meta = ['<a href="' + url + '"><code>' + esc(s.story_id) + "</code></a>"];
  if (s.branch) meta.push("<code>" + esc(s.branch) + "</code>");
  if (s.at) meta.push("spawned " + timeAgo(s.at) + (s.source ? " via " + esc(s.source) : ""));
  if (failed && s.error) meta.push('<span style="color:var(--red)">' + esc(s.error) + "</span>");
  return row({
    icon: "issue",
    iconCls: failed ? "failed" : s.pane_status === "waiting" ? "waiting" : "",
    title:
      '<a class="rtitle" href="' + url + '">' + esc(s.title || s.story_id) + "</a>" +
      (isFixerStory(s.story_id) ? " " + FIXER_BADGE : "") + label,
    meta: meta.join(" &middot; "),
    panes: paneLine(WORK_EMOJI, s.pane, s.pane_status),
    cls: " spawn" + (failed ? " failed" : ""),
  });
}

/** One PR row. */
function prRow(pr) {
  const url = "https://github.com/" + pr.owner + "/" + pr.repo + "/pull/" + pr.pr;
  const waiting = pr.paneStatus === "waiting";
  const limited = pr.paneStatus === "limit";
  const labels =
    (isFixerPR(pr) ? FIXER_BADGE + " " : "") +
    (pr.mergeConflict ? '<span class="conflict">conflict</span> ' : "") +
    (pr.labels || []).map((l) => '<span class="label">' + esc(l) + "</span>").join("");
  const statusPill = limited
    ? '<span class="' + statusClass("limit reached") + '">limit reached</span>'
    : waiting
      ? '<span class="' + statusClass("waiting for answer") + '">waiting for answer</span>'
      : '<span class="' + statusClass(pr.nextAction) + '">' + esc(pr.nextAction || "") + "</span>";

  const meta = ['<a href="' + url + '" target="_blank">#' + pr.pr + "</a>"];
  if (pr.branch) meta.push("<code>" + esc(pr.branch) + "</code>");
  if (pr.commentCount || pr.reviewCycles) {
    meta.push(
      (pr.commentCount || 0) + " comment" + (pr.commentCount === 1 ? "" : "s") +
      " &middot; " + (pr.reviewCycles || 0) + " cycles",
    );
  }
  if (pr.lastAction) meta.push(esc(pr.lastAction));
  if (pr.lastTime) meta.push(timeAgo(pr.lastTime));

  const merged = !!pr.merged;
  const draft = !merged && !!pr.draft;
  return row({
    icon: merged ? "merge" : "pr",
    iconCls: merged ? "merged" : draft ? "draft" : waiting ? "waiting" : "",
    title:
      '<a class="rtitle" href="' + url + '" target="_blank">' +
      esc(pr.title || pr.owner + "/" + pr.repo + "#" + pr.pr) + "</a>" + labels,
    meta: meta.join(" &middot; "),
    aside: statusPill,
    panes: paneLine(WORK_EMOJI, pr.pane, pr.paneStatus),
  });
}

/*
 * GitHub octicons, inlined so a PR, spawn or merged row shows the same status
 * circle the backlog list does. Fill comes from `.ricon svg` in the shell CSS.
 */
const ICONS = {
  issue: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"></path><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"></path></svg>',
  pr: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"></path></svg>',
  merge: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"></path></svg>',
};

/** The one row shape every list on this page uses. */
function row({ icon, iconCls, title, meta, aside, panes, cls }) {
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
 * One headed section per repo, in the data's own order — default repo first,
 * then the rest alphabetically, so a refresh does not reshuffle them. The
 * default repo is always shown even with nothing open; every other repo
 * appears only when it has something, so an idle repo leaves no empty heading.
 */
function renderRepoSections(prs, spawns) {
  const host = document.getElementById("repoSections");
  const byRepo = new Map();
  const bucket = (name) => {
    if (!byRepo.has(name)) byRepo.set(name, { prs: [], spawns: [] });
    return byRepo.get(name);
  };
  bucket(DEFAULT_REPO);
  prs.forEach((pr) => bucket(repoOf(pr)).prs.push(pr));
  spawns.forEach((s) => bucket(s.repo || DEFAULT_REPO).spawns.push(s));

  const names = [...byRepo.keys()].filter((n) => n && n !== DEFAULT_REPO).sort();
  names.unshift(DEFAULT_REPO);

  // Reuse the existing nodes when the repo SET is unchanged, so a refresh does
  // not blow away scroll position or anything open inside a section.
  const wanted = names.join(" ");
  if (host.dataset.repos !== wanted) {
    host.innerHTML = names
      .map((name) => {
        const id = sectionId(name);
        return (
          '<h2 class="repo-heading">' + esc(name) + "</h2>" +
          '<div class="listbox" id="' + id + '-spawnsSection" style="display:none">' +
          '<div id="' + id + '-spawns"></div></div>' +
          '<div class="listbox"><div id="' + id + '-prs"></div></div>'
        );
      })
      .join("");
    host.dataset.repos = wanted;
  }

  names.forEach((name) => {
    const id = sectionId(name);
    const group = byRepo.get(name) || { prs: [], spawns: [] };
    document.getElementById(id + "-spawnsSection").style.display = group.spawns.length ? "" : "none";
    document.getElementById(id + "-spawns").innerHTML = group.spawns.map(spawnRow).join("");
    document.getElementById(id + "-prs").innerHTML = group.prs.length
      ? group.prs.map(prRow).join("")
      : '<div class="list-empty">No open PRs.</div>';
  });
}

/**
 * Suppress a spawn whose branch already has a real PR row — the PR row takes
 * over. ringo prunes these server-side too; this is belt-and-braces against a
 * stale frame. Grooming agents never open a PR, so none of it applies to them.
 */
function render(prs, spawns) {
  const branches = new Set(prs.map((p) => p.branch).filter(Boolean));
  const panes = new Set(prs.map((p) => p.pane).filter(Boolean));
  const visible = spawns.filter(
    (s) => s.kind || (!branches.has(s.branch) && !branches.has(s.story_id) && !(s.pane && panes.has(s.pane))),
  );
  renderRepoSections(prs, visible);
}

// ---------------------------------------------------------------------------
// Connection pills
// ---------------------------------------------------------------------------

function setDot(id, on) {
  document.getElementById(id).className = "connected " + (on ? "on" : "off");
}

/** One pill per repo, so trails and tasks report separately. */
function updateMainCI(failures) {
  const host = document.getElementById("mainCIPills");
  host.innerHTML = "";
  const byRepo = new Map();
  (failures || []).forEach((f) => {
    const key = f.repo || f.owner + "/" + f.repo;
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key).push(f);
  });
  [...byRepo.keys()].sort().forEach((repo) => {
    const items = byRepo.get(repo);
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.title =
      repo + " main CI failing:\n" +
      items
        .map((f) => f.check + " · " + (f.sha || "").slice(0, 7) + (f.time ? " · " + timeAgo(f.time) : ""))
        .join("\n");
    const url = items.map((f) => f.url).find(Boolean);
    if (url) {
      pill.style.cursor = "pointer";
      pill.onclick = () => window.open(url, "_blank");
    }
    pill.innerHTML =
      '<span class="connected on" style="background:var(--red)"></span>' +
      '<span class="ico">🏗️</span>' +
      '<span class="label">' + esc(repo) + " CI: " + items.length + "</span>";
    host.appendChild(pill);
  });
}

/**
 * "pull failed" alone reads like a network or auth problem; most of these are
 * a dirty canonical checkout blocking the rebase pull. Name the real cause.
 */
function pullFailReason(err) {
  const e = String(err || "").toLowerCase();
  if (/unstaged changes|cannot pull with rebase|would be overwritten|commit or stash|local changes/.test(e))
    return "local edits block pull";
  if (/non-fast-forward|not possible to fast-forward|diverg/.test(e)) return "diverged — needs manual merge";
  if (/could not read username|authentication failed|permission denied|cannot run ssh|host key/.test(e))
    return "auth/network error";
  if (/conflict/.test(e)) return "merge conflict";
  return "pull failed";
}

function updatePullFail(failures) {
  const pill = document.getElementById("pullFailPill");
  if (!failures || !failures.length) {
    pill.style.display = "none";
    return;
  }
  pill.style.display = "";
  const dot = document.getElementById("pullFailDot");
  dot.className = "connected on";
  dot.style.background = "var(--red)";
  document.getElementById("pullFailLabel").textContent = failures
    .map((f) => f.repo + ": " + pullFailReason(f.error))
    .join(", ");
  pill.title = failures
    .map((f) => f.owner + "/" + f.repo + " — " + pullFailReason(f.error) + "\n  " + String(f.error || "git pull failed").replace(/\n/g, "\n  "))
    .join("\n");
}

/** One pill per configured long-lived agent, built once and updated in place. */
function updateAgents(agents) {
  const host = document.getElementById("agentPills");
  (agents || []).forEach((a) => {
    const detected = !!(a.state || {}).detected;
    let pill = document.getElementById("agentPill-" + a.name);
    if (!pill) {
      pill = document.createElement("span");
      pill.className = "pill";
      pill.id = "agentPill-" + a.name;
      pill.innerHTML =
        '<span class="connected off"></span><span class="ico"></span><span class="label"></span>';
      pill.querySelector(".ico").textContent = a.icon || "🎼";
      pill.querySelector(".label").textContent = a.name;
      host.appendChild(pill);
    }
    pill.querySelector(".connected").className = "connected " + (detected ? "on" : "off");
    pill.classList.toggle("ok", detected);
    pill.title = detected
      ? a.name + " pane (" + (a.dir || "") + ")"
      : "no " + a.name + " pane";
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
  fixers = envelope.fixers || [];
  renderCIFixer(fixers);
  render(envelope.prs || [], envelope.spawns || []);
  setDot("tmuxDot", !!envelope.tmuxConnected);
  document.getElementById("tmuxPill").classList.toggle("ok", !!envelope.tmuxConnected);
  updateMainCI(envelope.mainCIFailures);
  updatePullFail(envelope.pullFailures);
  updateAgents(envelope.agents);
};

source.onopen = () => {
  setDot("eventsDot", true);
  document.getElementById("eventsPill").classList.add("ok");
};

source.onerror = () => {
  setDot("eventsDot", false);
  document.getElementById("eventsPill").classList.remove("ok");
};

// ---------------------------------------------------------------------------
// Manual spawn — the one control this page carries, and the reason the repo
// list is configuration. It posts to ringo, which owns the spawn loop.
// ---------------------------------------------------------------------------

document.getElementById("spawn").addEventListener("click", async () => {
  const button = document.getElementById("spawn");
  const status = document.getElementById("spawnStatus");
  const task = document.getElementById("task");
  const message = task.value.trim();
  if (!message) return;
  button.disabled = true;
  status.textContent = "Spawning...";
  try {
    const response = await fetch(ringoUrl("/spawn"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoDir: document.getElementById("repo").value, message }),
    });
    const text = await response.text();
    status.textContent = (response.ok ? "Spawned: " : "Error: ") + text;
    if (response.ok) task.value = "";
  } catch (e) {
    status.textContent = "Error: " + e.message;
  }
  button.disabled = false;
});
