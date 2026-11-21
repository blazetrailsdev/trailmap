/**
 * The fleet dashboard's configuration.
 *
 * ringo builds this page's two variable pieces in Go: the repo `<option>` list
 * is `fmt.Sprintf`'d out of `DashboardConfig.RepoPaths` into the one `%s` in a
 * 2,442-line constant (`webhook/dashboard.go:2348`), and the SSE endpoint is
 * hardcoded same-origin (`dashboard.go:2154`). Neither can stay that way here:
 * a `.tse` renders the options from data, and trailmap is a different origin
 * from the Go process that owns the stream.
 *
 * Both are settings, so the page is deployable against a fleet whose repo set
 * trailmap does not otherwise know about. The repo list is `config.x.fleet`,
 * which config/application.ts fills from the environment at boot.
 */
import { Trails } from "@blazetrails/trailties";

/** One entry of ringo's `RepoPaths`: the `owner/repo` name and its checkout. */
export interface FleetRepo {
  /** `owner/repo`, the option's label — and what ringo keys spawns by. */
  name: string;
  /** The local checkout path, which is the option's VALUE, as in ringo. */
  path: string;
}

/**
 * The repos the manual spawn control offers, from `config.x.fleet.repoPaths`
 * (`FLEET_REPO_PATHS`).
 *
 * Spelled as ringo spells the pairing — `owner/repo=/path/to/checkout`,
 * comma-separated — because the two sides are not derivable from each other
 * and a host that runs ringo already knows both. Sorted by name: Go's map
 * iteration gives ringo's list a different order on every request, which is a
 * bug the port does not have to inherit.
 */
export function fleetRepos(): FleetRepo[] {
  const raw = (Trails.application!.config.x.fleet.repoPaths as string | undefined)?.trim();
  if (!raw) return [];

  const repos: FleetRepo[] = [];
  for (const entry of raw.split(",")) {
    const at = entry.indexOf("=");
    if (at < 0) continue;
    const name = entry.slice(0, at).trim();
    const path = entry.slice(at + 1).trim();
    if (name && path) repos.push({ name, path });
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The repos the spawn dialog offers first, in this order: the ones spawned
 * into most. Every other repo follows them by name.
 */
export const SPAWN_ORDER: readonly string[] = ["blazetrailsdev/trails", "blazetrailsdev/trailmap", "blazetrailsdev/tasks"];

/**
 * ringo's origin does NOT live here. It is `Setting.ringoBase()`
 * (app/models/setting.ts) — a row in the `settings` table, falling back to
 * `RINGO_BASE`, normalised once.
 *
 * There is one ringo, so there is one resolver. A second one here would be a
 * second answer to the same question, and the two would be able to disagree
 * the moment anything wrote a row: the setting is read on four relay paths
 * and two pages, and they must all reach the same origin.
 */

/** Where the fleet page opens its WebSocket. */
export const FLEET_SOCKET_PATH = "/fleet/socket";

/** The prefix the fleet page's controls post under; the rest is ringo's own path. */
export const FLEET_CONTROL_PATH = "/fleet/control";

/** Where the fleet page polls for the reviewer of each open PR. */
export const FLEET_REVIEWERS_PATH = "/fleet/reviewers";

/**
 * The rest of what the page reads from ringo outside the stream, by the name
 * the page asks for it under (`/fleet/read/usage`) and the ringo path that
 * answers. An allowlist for the reason `FLEET_CONTROLS` is one: the relay
 * reaches ringo's whole origin, and the page needs these and nothing else.
 */
export const FLEET_READ_PATH = "/fleet/read";

export const FLEET_READS: Readonly<Record<string, string>> = {
  usage: "usage-status",
  "codex-usage": "codex-usage-status",
  asks: "ask/list",
  "drain-status": "reviewer/drain-status",
  // The loop's state, as the settings panel draws it. Its WRITES are controls.
  "spawn-loop": "spawnloop/config",
  "reviewer-config": "reviewer/config",
  "broadcast-targets": "broadcast/targets",
  // The pulls tab's External inbox (RFC 0253): open external PRs, and one
  // PR's stored review draft, which takes `repo` and `pr` (`externalReviewQuery`).
  "external-prs": "api/external-prs",
  "external-review": "api/external-reviews",
  // Per-PR trust grants, and external reviews held off trusted PRs; both
  // take `repo` alone (`repoQuery`).
  "pr-trust": "api/pr-trust",
  "external-on-trusted": "api/external-on-trusted",
};

/** The reads that take `?repo=` alone, checked by `repoQuery`. */
export const REPO_READS: readonly string[] = ["pr-trust", "external-on-trusted"];

/** `?repo=<owner/repo>`, or "" when it is not one. */
export function repoQuery(repo: string): string {
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)) return "";
  return `?repo=${encodeURIComponent(repo)}`;
}

/**
 * The query `external-review` forwards: `?repo=<owner/repo>&pr=<n>`, or ""
 * when either is not one, so nothing unchecked reaches ringo's path.
 */
export function externalReviewQuery(repo: string, pr: string): string {
  const query = repoQuery(repo);
  if (query === "" || !/^[0-9]{1,10}$/.test(pr)) return "";
  return `${query}&pr=${pr}`;
}

/** The prefix of the pane-screen relay; the pane page polls `<prefix>/<n>/screen`. */
export const FLEET_PANE_PATH = "/fleet/pane";

/**
 * Whether `id` is a tmux pane id as a URL carries it: the digits of `%42`,
 * without the `%`. Bounded, so nothing unbounded reaches ringo's path either.
 *
 * The browser's half of this grammar is `paneHref` in
 * `app/assets/javascripts/fleet-format.js`, which cannot import this file.
 * `test/assets/fleet-format.test.js` holds the two to the same answer.
 */
export function isPaneId(id: string): boolean {
  return /^[0-9]{1,10}$/.test(id);
}

/**
 * The longest message the pane page may send, in UTF-8 bytes: ringo's own cap
 * (`paneSendMaxBytes`, webhook/panesend.go), so trailmap refuses what ringo
 * would and never forwards an unbounded body.
 */
export const PANE_MESSAGE_MAX_BYTES = 4096;

/** Why `text` cannot be sent to a pane, or null when it can. ringo decides the rest. */
export function paneMessageProblem(text: string): string | null {
  if (text === "") return "message is empty";
  if (new TextEncoder().encode(text).length > PANE_MESSAGE_MAX_BYTES) {
    return `message is longer than ${PANE_MESSAGE_MAX_BYTES} bytes`;
  }
  return null;
}

/**
 * The keys the pane page may press, by tmux name: ringo's own allowlist
 * (`paneKeyNames`, webhook/panekeys.go), so trailmap refuses what ringo would.
 */
export const PANE_KEYS: readonly string[] = ["Enter", "Up", "Down", "Left", "Right", "Escape", "Tab"];

/** ringo's cap on keys in one request (`paneKeysMax`). */
export const PANE_KEYS_MAX = 16;

/** Why `keys` cannot be pressed in a pane, or null when they can. */
export function paneKeysProblem(keys: unknown): string | null {
  if (!Array.isArray(keys) || keys.length === 0) return "no keys given";
  if (keys.length > PANE_KEYS_MAX) return `at most ${PANE_KEYS_MAX} keys at a time`;
  for (const key of keys) {
    if (typeof key !== "string" || !PANE_KEYS.includes(key)) {
      return `key ${String(key)} is not one of ${PANE_KEYS.join(", ")}`;
    }
  }
  return null;
}

/** The longest `have` the screen relay passes on. ringo's hashes are far shorter. */
export const SCREEN_HASH_MAX = 128;

/**
 * Whether `have` is a screen hash worth sending to ringo: anything the page
 * could have been handed, up to a length. Bounded for the reason the pane id
 * is: it is forwarded to a process on the private network.
 */
export function isScreenHash(have: string): boolean {
  return have.length <= SCREEN_HASH_MAX;
}

/**
 * ringo's control endpoints the fleet page may reach through trailmap. An
 * allowlist, because this route forwards to a process that can merge pull
 * requests: a path is added here when a button for it is added to the page,
 * and not before.
 */
export const FLEET_CONTROLS: readonly string[] = [
  "merge-pr",
  "spawnloop/dismiss",
  "spawnloop/dismiss-failed",
  "spawnloop/config",
  "spawnloop/skip",
  "spawnloop/spawn-now",
  "ci-fixer/spawn",
  "reviewer/assign",
  "worker/spawn",
  "broadcast",
  "drain",
  "drain-one",
  "poke-stalled",
  "cancel-cleanup",
  "ask/answer",
  "reviewer/drain-codex",
  "reviewer/drain-claude",
  "pause",
  "refresh-usage",
  // /rfc/<id>'s dispatches: "Spawn batch", and "Sunset" (rfc-refine, mode sunset).
  "spawnloop/rfc-batch-spawn",
  "spawnloop/rfc-refine",
  // The dashboard's spawn dialog: the loop's start script, worktree and model.
  "spawnloop/dashboard-spawn",
  // /story/<id>'s "Spawn worker".
  "spawnloop/story-spawn",
  // The pulls tab's "Draft review" on an external PR.
  "external-review/start",
  // Its "Trust this PR", and "Forward to agent" on an external review.
  "api/pr-trust",
  "external-review/forward",
];
