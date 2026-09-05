import type { AbstractController } from "@blazetrails/actionpack";

/**
 * Requests that reach trailmap arrive over one of two paths:
 *
 * - the public hostname, proxied by dokku's nginx, which always sets the
 *   `X-Forwarded-*` family and a public `Host`;
 * - loopback on the box, straight to the container's published port, with no
 *   forwarding headers at all.
 *
 * The JSON API is for the second audience only — the CLI and ringo's Go
 * process — so anything carrying proxy provenance is refused. `request.local`
 * cannot stand in for this: docker's userland proxy rewrites the source
 * address, so even a loopback request arrives from the bridge gateway.
 */
interface LoopbackRequest {
  host: string;
  headers: { get(key: string): unknown };
}

interface LoopbackGuarded {
  request: LoopbackRequest;
  render(options: { json: unknown; status: number }): void;
}

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1", "[::1]"];

export function isLoopbackRequest(request: LoopbackRequest): boolean {
  const forwarded = request.headers.get("X-Forwarded-For");
  if (forwarded != null && String(forwarded) !== "") return false;
  return LOOPBACK_HOSTS.includes(request.host.toLowerCase());
}

/**
 * A `beforeAction` that refuses anything not arriving on loopback. Returning
 * `false` halts the callback chain, so the action never runs.
 */
export async function requireLoopback(
  controller: AbstractController.AbstractController,
): Promise<boolean> {
  const base = controller as unknown as LoopbackGuarded;
  if (isLoopbackRequest(base.request)) return true;

  base.render({
    json: { error: "not_found" },
    status: 404,
  });
  return false;
}
