import { Owner } from "../../models/owner.ts";

interface ViewerRequest {
  getHeader(key: string): unknown;
}

/**
 * Who is looking at the page: an `Owner`, or `null` for nobody in particular.
 *
 * trailmap keeps no session of its own, because it already sits behind one.
 * Every request from off the box comes through dokku's nginx, where Authelia
 * authenticates it (`dokku sso:protect`, docs/deploy.md) and the proxy sets
 * `Remote-User` to the signed-in user — `proxy_set_header`, which REPLACES
 * whatever the client sent, so the header cannot be forged through the only
 * door a stranger has. The viewer is the `Owner` whose login that is.
 *
 * A second cookie here would be a second answer to "who is this", and one that
 * keeps saying yes after Authelia has signed the user out.
 *
 * Anonymous, and so reading public repositories only, is everything else: a
 * request with no `Remote-User` (loopback — the CLI, ringo, the smoke suite —
 * where nginx is not in the path), and a signed-in user with no `Owner` row,
 * who is authenticated and is nobody the hub knows. A request on the box can
 * put any name in the header, and that is not a hole this closes: whoever is
 * on the box can read both databases outright.
 */
export async function viewerOf(request: ViewerRequest): Promise<Owner | null> {
  const login = String(request.getHeader("HTTP_REMOTE_USER") ?? "").trim();
  return login === "" ? null : Owner.findByLogin(login);
}
