/*
 * The ⌘K palette (RFC 0232 "Search"): sessions and PRs matched in the browser
 * from the current frame, stories from `fleet/stories?q=`, grouped by kind
 * with scope chips, and the actions that replaced the broadcast and spawn
 * forms. Pure: `dashboard.js` opens the dialog and assigns what this returns.
 */
import { esc, isGrooming, OCTICON, STAGE_ICONS, stageName } from "./fleet-format.js";
import { sessionKey, sessionStories, stageOf } from "./fleet-sessions.js";

/** The kinds, in the order their groups are drawn. */
export const PALETTE_KINDS = [
  ["session", "Sessions"],
  ["story", "Stories"],
  ["pr", "Pull requests"],
  ["action", "Actions"],
];

/** How many results one group draws. */
export const PALETTE_GROUP_MAX = 8;

/**
 * How well `text` matches `query`, lower is better: 0 it starts with it, 1 a
 * word in it does, 2 it contains it; -1 no match. An empty query matches
 * everything at 2.
 */
export function matchScore(text, query) {
  const hay = String(text || "").toLowerCase();
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return 2;
  const at = hay.indexOf(needle);
  if (at < 0) return -1;
  if (at === 0) return 0;
  return /[\s/#_.-]/.test(hay[at - 1]) ? 1 : 2;
}

/** The best score over several fields, -1 when none matches. */
const best = (fields, query) =>
  fields.reduce((top, field) => {
    const score = matchScore(field, query);
    return score >= 0 && (top < 0 || score < top) ? score : top;
  }, -1);

/**
 * `text` escaped, with every match of `query` marked. Matched ASCII-case-
 * insensitively on the text itself, so a character whose lower case has a
 * different length (`İ`) never shifts a mark.
 */
export function highlight(text, query) {
  const raw = String(text == null ? "" : text);
  const needle = String(query || "").trim();
  if (!needle) return esc(raw);
  const fold = (c) => (c >= "A" && c <= "Z" ? c.toLowerCase() : c);
  const at = (i) => needle.split("").every((c, k) => fold(raw[i + k] || "") === fold(c));
  let out = "";
  let from = 0;
  for (let i = 0; i + needle.length <= raw.length; ) {
    if (at(i)) {
      out += esc(raw.slice(from, i)) + "<mark>" + esc(raw.slice(i, i + needle.length)) + "</mark>";
      i += needle.length;
      from = i;
    } else i++;
  }
  return out + esc(raw.slice(from));
}

const prUrl = (s) => "https://github.com/" + s.owner + "/" + s.repo + "/pull/" + s.pr;
/** `owner/repo` for both row shapes: a PR splits them, a spawn's `repo` is already whole. */
export const repoName = (s) => (String(s.repo || "").includes("/") ? String(s.repo) : (s.owner ? s.owner + "/" : "") + (s.repo || ""));

/** The frame's sessions that match, best first, ties in list order. */
export function paletteSessions(rows, ctx, query) {
  return rows
    .filter((s) => !isGrooming(s) && !s.merged)
    .map((s, at) => {
      const { lead, rest } = sessionStories(s, ctx.stories);
      const title = lead ? lead.id : s.story_id || s.title || s.repo + "#" + s.pr;
      const fields = [title, lead && lead.title, s.title, s.branch, s.pr != null ? s.repo + "#" + s.pr : "", ...rest.map((r) => r.id)];
      const stage = stageOf(s, ctx);
      return {
        kind: "session",
        key: sessionKey(s),
        pane: s.pane || "",
        title,
        sub: repoName(s) + " · " + stageName(stage) + (s.pr != null ? " · #" + s.pr : ""),
        stage,
        repo: repoName(s),
        score: best(fields, query),
        at,
      };
    })
    .filter((r) => r.score >= 0)
    .sort((a, b) => a.score - b.score || a.at - b.at);
}

/** The frame's PRs that match, open and merged. */
export function palettePrs(prs, ctx, query) {
  return (prs || [])
    .map((s, at) => ({
      kind: "pr",
      href: prUrl(s),
      title: s.title || s.repo + "#" + s.pr,
      sub: s.repo + "#" + s.pr + " · " + (s.merged ? "merged" : s.draft ? "draft" : "open"),
      stage: stageOf(s, ctx),
      repo: repoName(s),
      score: best([s.title, s.repo + "#" + s.pr, "#" + s.pr, s.branch], query),
      at,
    }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => a.score - b.score || a.at - b.at);
}

/** `fleet/stories?q=`'s answer as results, in the server's order. */
export function paletteStories(stories) {
  return (stories || []).map((s) => ({
    kind: "story",
    href: "/story/" + encodeURIComponent(s.id),
    title: s.id,
    sub: (s.title && s.title !== s.id ? s.title + " · " : "") + "RFC " + s.rfc + " · " + s.status,
    repo: "",
  }));
}

/**
 * The actions for a query: message the top session, spawn a session for the
 * text, and broadcast it to every agent or only the CI-red ones. Every one
 * uses the page's existing control request.
 */
export function paletteActions(query, top, audiences) {
  const text = String(query || "").trim();
  const actions = [];
  if (top && top.pane) actions.push({ kind: "action", action: "message", key: top.key, pane: top.pane, title: "Message " + top.title, sub: "Typed into its pane" });
  actions.push({ kind: "action", action: "spawn", title: text ? "Spawn a session for “" + text + "”" : "Spawn a session", sub: "Pick the repo next" });
  const all = (audiences && audiences.all) || 0;
  const red = (audiences && audiences["ci-red"]) || 0;
  actions.push({ kind: "action", action: "broadcast", target: "all", title: (text ? "Broadcast “" + text + "”" : "Broadcast") + " to all agents", sub: all + " live panes" });
  if (red) actions.push({ kind: "action", action: "broadcast", target: "ci-red", title: (text ? "Broadcast “" + text + "”" : "Broadcast") + " to CI-red agents", sub: red + " panes failing CI" });
  return actions;
}

/**
 * The results a scope keeps, grouped by kind, each group capped. `scope` is
 * `{ kind, repo }`: a kind of "all" keeps every kind, and a repo keeps only
 * results in it (stories carry no repo, so a repo scope drops them).
 */
export function paletteGroups(results, scope) {
  const kept = results.filter(
    (r) =>
      (scope.kind === "all" || r.kind === scope.kind || r.kind === "action") &&
      (!scope.repo || r.kind === "action" || r.repo === scope.repo),
  );
  return PALETTE_KINDS.map(([kind, label]) => ({ kind, label, items: kept.filter((r) => r.kind === kind).slice(0, PALETTE_GROUP_MAX) })).filter(
    (g) => g.items.length,
  );
}

/** Every result of the groups, in the order ↑ and ↓ move through them. */
export const paletteFlat = (groups) => groups.flatMap((g) => g.items);

/** The next selection after a key: ↓ and ↑ wrap. */
export function paletteMove(selected, count, key) {
  if (!count) return 0;
  if (key === "ArrowDown") return (selected + 1) % count;
  if (key === "ArrowUp") return (selected - 1 + count) % count;
  return Math.min(selected, count - 1);
}

const DOC = OCTICON('<path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"></path>');
const ARROW = OCTICON('<path d="M8.22 2.97a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l2.97-2.97H3.75a.75.75 0 0 1 0-1.5h7.44L8.22 4.03a.75.75 0 0 1 0-1.06Z"></path>');

/** The results' markup, the selected one marked for the listbox. */
export function paletteHtml(groups, selected, query) {
  if (!groups.length) return '<p class="palette-empty">No matches.</p>';
  let n = 0;
  return groups
    .map(
      (g) =>
        '<div class="palette-group" role="presentation">' + g.label + "</div>" +
        g.items
          .map((r) => {
            const at = n++;
            const icon = r.stage ? STAGE_ICONS[r.stage] : r.kind === "action" ? ARROW : DOC;
            return (
              '<div class="palette-item' + (at === selected ? " on" : "") + (r.stage ? " st-c-" + r.stage : "") + '" role="option" id="palette-opt-' + at +
              '" aria-selected="' + (at === selected) + '" data-ui="palette-pick" data-index="' + at + '">' +
              '<span class="ico">' + icon + "</span>" +
              '<span class="palette-text"><b>' + highlight(r.title, r.kind === "action" ? "" : query) + "</b><small>" + highlight(r.sub, r.kind === "action" ? "" : query) + "</small></span>" +
              '<span class="palette-right">' + (at === selected ? '<kbd>↵</kbd>' : "") + "</span></div>"
            );
          })
          .join(""),
    )
    .join("");
}

/** The scope chips: All and each kind with its count, then each repo. */
export function scopeChips(results, scope, repos) {
  const chip = (attrs, label, on) =>
    '<button type="button" class="chip" data-ui="palette-scope" ' + attrs + ' aria-pressed="' + on + '">' + esc(label) + "</button>";
  const count = (kind) => results.filter((r) => r.kind === kind).length;
  return (
    chip('data-kind="all"', "All", scope.kind === "all" && !scope.repo) +
    PALETTE_KINDS.filter(([kind]) => kind !== "action")
      .map(([kind, label]) => chip('data-kind="' + kind + '"', label + " " + count(kind), scope.kind === kind))
      .join("") +
    repos.map((repo) => chip('data-repo="' + esc(repo) + '"', repo.replace(/^.*\//, ""), scope.repo === repo)).join("")
  );
}
