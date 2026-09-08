/*
 * The fleet dashboard's pure half: everything that turns one frame of ringo's
 * SSE envelope into HTML, with no `document` in sight.
 *
 * Split out of `dashboard.js` so it can be tested. The DOM wiring there is a
 * handful of `innerHTML =` assignments; ALL of the logic worth getting right —
 * which phase a red repo is in, which spawn a PR row supersedes, what a git
 * error actually means, how repos order — lives here and is exercised directly
 * by `test/assets/fleet-format.test.js`.
 *
 * Ported from the render functions inside ringo's constant dashboard HTML
 * (`webhook/dashboard.go:515-2306`).
 */

/** Escape into text/attribute context — the envelope is not ours to trust. */
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
 * error, purple ◑ out of quota, muted ○ idle. The limit dot is its own GLYPH
 * as well as its own colour — an exhausted agent looks idle in every other
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

/** One row of the compact pane mini-table; '' when there is no pane. */
export function paneLine(label, pane, status) {
  if (!pane) return "";
  const role = label === WORK_EMOJI ? "worker" : "reviewer";
  return (
    '<div class="pcell"><span class="plabel" title="' + role + '">' + label + "</span>" +
    '<span class="pval"><code>' + esc(pane) + "</code>" + paneDot(status) + "</span></div>"
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
 * beats both — main is green again and the card is on its way out.
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
      return '<div class="fixer-repo">' + rows.join("") + "</div>";
    })
    .join("");
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
 * which are about a repo's default branch — this one says whether the checks
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
    panes: paneLine(WORK_EMOJI, s.pane, s.pane_status),
    cls: " spawn" + (failed ? " failed" : ""),
  });
}

/** One PR row. */
export function prRow(pr, fixers = [], now = Date.now()) {
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
  return row({
    icon: merged ? "merge" : "pr",
    iconCls: merged ? "merged" : draft ? "draft" : pr.paneStatus === "waiting" ? "waiting" : "",
    title:
      '<a class="rtitle" href="' + url + '" target="_blank">' +
      esc(pr.title || pr.owner + "/" + pr.repo + "#" + pr.pr) + "</a>" +
      ciIcon(pr.ciStatus) + labels,
    meta: meta.join(" &middot; "),
    aside: statusPill,
    panes: paneLine(WORK_EMOJI, pr.pane, pr.paneStatus),
  });
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
 * refresh does not blow away scroll position or anything open inside it —
 * which is what `repoSectionsKey` is compared against.
 */
export function repoSectionScaffold(sections) {
  return sections
    .map(({ name }) => {
      const id = sectionId(name);
      return (
        '<h2 class="repo-heading">' + esc(name) + "</h2>" +
        '<div class="listbox" id="' + id + '-spawnsSection" style="display:none">' +
        '<div id="' + id + '-spawns"></div></div>' +
        '<div class="listbox"><div id="' + id + '-prs"></div></div>'
      );
    })
    .join("");
}

export const repoSectionsKey = (sections) => sections.map((s) => s.name).join(" ");

/**
 * Drop a spawn whose branch already has a real PR row — the PR row takes over.
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
 * alphabetically — a stable order, unlike insertion order, which tracks
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
 * otherwise current — so name the real cause.
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
