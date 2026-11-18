/*
 * The spawn dialog: a task box that grows with the prompt, the repos as an
 * ordered row the keyboard can pick from and rearrange, and the spawn's
 * options with the loop's own as the default. Pure: `dashboard.js` owns the
 * DOM and the viewer's saved order.
 */
import { esc } from "./fleet-format.js";

/** Where a viewer's own repo order is kept, in their browser. */
export const SPAWN_ORDER_KEY = "trailmap.spawnRepoOrder";

/** The tallest the task box grows before it scrolls, as a share of the viewport. */
export const SPAWN_TASK_MAX_VH = 0.5;

/**
 * The repos in the viewer's order: the names they saved first, in that order,
 * then every repo they have not placed, in the server's order. A saved name
 * that is no longer offered is dropped.
 */
export function orderRepos(repos, saved) {
  const byName = new Map(repos.map((r) => [r.name, r]));
  const placed = (Array.isArray(saved) ? saved : []).filter((name, at, all) => byName.has(name) && all.indexOf(name) === at);
  return [...placed.map((name) => byName.get(name)), ...repos.filter((r) => !placed.includes(r.name))];
}

/** The order after moving `name` one place by `step` (-1 earlier, 1 later), as names. */
export function moveRepo(names, name, step) {
  const at = names.indexOf(name);
  const to = at + step;
  if (at < 0 || to < 0 || to >= names.length) return names.slice();
  const out = names.slice();
  [out[at], out[to]] = [out[to], out[at]];
  return out;
}

/**
 * What a key does in the dialog, or null for a key it leaves alone. Matched on
 * `code`, not `key`: on a Mac, Option turns `1` into `¡` and `[` into `“`.
 *
 * - ⌘/Ctrl+Enter spawns; a bare Enter is a newline in the task.
 * - ⌥1–⌥9 picks the repo in that place.
 * - ⌥[ and ⌥] move the picked repo one place earlier or later.
 * - ⌥0 puts the order back to the server's.
 */
export function spawnKey(event) {
  if (event.isComposing) return null;
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) return { kind: "spawn" };
  if (!event.altKey || event.metaKey || event.ctrlKey) return null;
  const digit = /^Digit([0-9])$/.exec(event.code || "");
  if (digit) return digit[1] === "0" ? { kind: "reset" } : { kind: "pick", index: Number(digit[1]) - 1 };
  if (event.code === "BracketLeft") return { kind: "move", step: -1 };
  if (event.code === "BracketRight") return { kind: "move", step: 1 };
  return null;
}

/** The repo row: one radio per repo, its place as its shortcut. */
export function repoChips(repos, picked) {
  return repos
    .map((r, at) => {
      const on = r.name === picked;
      const short = r.name.replace(/^.*\//, "");
      return (
        '<button type="button" class="chip spawn-repo" role="radio" data-ui="spawn-repo" data-name="' + esc(r.name) +
        '" aria-checked="' + on + '" tabindex="' + (on ? "0" : "-1") + '" title="' + esc(r.name) + " — " + esc(r.path) + '">' +
        esc(short) + (at < 9 ? ' <kbd>⌥' + (at + 1) + "</kbd>" : "") + "</button>"
      );
    })
    .join("");
}

/**
 * The model `<option>`s: the loop's model first, as the default (an empty
 * value, so ringo applies whatever its setting is by the time the spawn
 * lands), then every model ringo supports.
 */
export function modelOptions(config, chosen) {
  const loop = (config && config.spawn_model) || "";
  const models = (config && config.supported_models) || [];
  const option = (value, label) =>
    '<option value="' + esc(value) + '"' + (value === chosen ? " selected" : "") + ">" + esc(label) + "</option>";
  return option("", loop ? "Loop default (" + loop + ")" : "Loop default") + models.map((m) => option(m, m)).join("");
}

/**
 * The worktree name ringo derives from the task, before its random suffix.
 * btwhooks' `HandleDashboardSpawn` (webhook/spawnloop.go:3562 on the spawn-options branch) takes the
 * first line that is not blank once trimmed and passes it to
 * `worktreeSlugN(first, 40)` (webhook/spawnloop.go:1816), falling back to
 * "task": — letters and digits kept, a space, `-`,
 * `_` or `/` a single dash, anything else dropped.
 */
export function derivedName(task) {
  const first = String(task || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  let slug = "";
  for (const c of first.toLowerCase()) {
    if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9")) slug += c;
    else if (" -_/".includes(c) && slug && !slug.endsWith("-")) slug += "-";
  }
  slug = slug.replace(/^-+|-+$/g, "");
  if (slug.length > 40) slug = slug.slice(0, 40).replace(/-+$/, "");
  return slug || "task";
}

/** The task box's height for its content, capped. */
export const taskHeight = (scrollHeight, viewport) => Math.min(scrollHeight, Math.round(viewport * SPAWN_TASK_MAX_VH));
