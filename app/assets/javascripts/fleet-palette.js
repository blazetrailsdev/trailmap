/*
 * The ⌘K palette (RFC 0232 "Search"): sessions and PRs matched in the browser
 * from the current frame, stories from `fleet/stories?q=`, grouped by kind
 * with scope chips, and the actions that replaced the broadcast and spawn
 * forms. Pure: `dashboard.js` opens the dialog and assigns what this returns.
 */
import { esc, STAGE_ICONS, stageName } from "./fleet-format.js";
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

/** `text` escaped, with every match of `query` marked. */
export function highlight(text, query) {
  const raw = String(text == null ? "" : text);
  const needle = String(query || "").trim();
  if (!needle) return esc(raw);
  const lower = raw.toLowerCase();
  const find = needle.toLowerCase();
  let out = "";
  let from = 0;
  for (let at = lower.indexOf(find); at >= 0; at = lower.indexOf(find, from)) {
    out += esc(raw.slice(from, at)) + "<mark>" + esc(raw.slice(at, at + find.length)) + "</mark>";
    from = at + find.length;
  }
  return out + esc(raw.slice(from));
}

const prUrl = (s) => "https://github.com/" + s.owner + "/" + s.repo + "/pull/" + s.pr;
/** `owner/repo` for both row shapes: a PR splits them, a spawn's `repo` is already whole. */
export const repoName = (s) => (String(s.repo || "").includes("/") ? String(s.repo) : (s.owner ? s.owner + "/" : "") + (s.repo || ""));

/** The frame's sessions that match, best first, ties in list order. */
export function paletteSessions(rows, ctx, query) {
  return rows
    .filter((s) => !s.kind && !s.merged)
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

const DOC = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" d="M4 1.5h5.5L12.5 4.5V14.5h-8.5z M6 7h4M6 10h4"></path></svg>';
const ARROW = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" d="M2 8h10M8 4l4 4-4 4"></path></svg>';

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
