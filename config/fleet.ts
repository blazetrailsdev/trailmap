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
import { env } from "@blazetrails/activesupport/process-adapter";

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
 * Where the browser opens its `EventSource`.
 *
 * Default same-origin `/events`, which is ringo's own spelling. See
 * `docs/fleet-dashboard.md` for why the browser connects to ringo's stream
 * directly rather than trailmap proxying it, and what the deployment has to do
 * to make same-origin true.
 */
export function fleetEventsUrl(): string {
  return env.RINGO_EVENTS_URL?.trim() || "/events";
}
