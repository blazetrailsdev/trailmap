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
 * Both come from the environment, so the page is deployable against a fleet
 * whose repo set trailmap does not otherwise know about.
 */
import { env } from "@blazetrails/ruby-compat";

/** One entry of ringo's `RepoPaths`: the `owner/repo` name and its checkout. */
export interface FleetRepo {
  /** `owner/repo`, the option's label — and what ringo keys spawns by. */
  name: string;
  /** The local checkout path, which is the option's VALUE, as in ringo. */
  path: string;
}

/**
 * The repos the manual spawn control offers, from `FLEET_REPO_PATHS`.
 *
 * Spelled as ringo spells the pairing — `owner/repo=/path/to/checkout`,
 * comma-separated — because the two sides are not derivable from each other
 * and a host that runs ringo already knows both. Sorted by name: Go's map
 * iteration gives ringo's list a different order on every request, which is a
 * bug the port does not have to inherit.
 */
export function fleetRepos(): FleetRepo[] {
  const raw = env.FLEET_REPO_PATHS?.trim();
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
 * ringo's origin as THIS PROCESS reaches it, e.g. `http://btwhooks.web:8080`
 * on the `fleet` docker network. Null when unset, which leaves the fleet page
 * with nothing to relay; it says so on the page, it does not guess.
 *
 * Not a URL the browser ever sees. The browser talks only to trailmap
 * (`FLEET_SOCKET_PATH`, `FLEET_CONTROL_PATH`), which reads ringo's stream and
 * forwards the page's controls. See `docs/fleet-dashboard.md`.
 */
export function ringoBase(): string | null {
  return normalizeOrigin(env.RINGO_BASE);
}

/**
 * One origin, trimmed and without its trailing slash, or null for nothing.
 *
 * Shared with `Setting.ringoBase()`, which resolves the same setting from a
 * database row before falling back to this variable: both spellings have to
 * normalise identically, or a row with a trailing slash would build
 * `http://host//events` where the environment built `http://host/events`.
 */
export function normalizeOrigin(raw: string | null | undefined): string | null {
  const base = raw?.trim().replace(/\/+$/, "");
  return base ? base : null;
}

/** Where the fleet page opens its WebSocket. */
export const FLEET_SOCKET_PATH = "/fleet/socket";

/** The prefix the fleet page's controls post under; the rest is ringo's own path. */
export const FLEET_CONTROL_PATH = "/fleet/control";

/** Where the fleet page polls for the reviewer of each open PR. */
export const FLEET_REVIEWERS_PATH = "/fleet/reviewers";

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
  "ci-fixer/spawn",
];
