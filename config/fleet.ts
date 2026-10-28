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
};

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
  "spawn",
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
];
