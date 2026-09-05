import type { AbstractController } from "@blazetrails/actionpack";

interface LoopbackRequest {
  getHeader(key: string): unknown;
}

interface LoopbackGuarded {
  request: LoopbackRequest;
  render(options: { json: unknown; status: number }): void;
}

/**
 * Every header a proxy adds to say "I forwarded this". Any one of them is
 * enough to disqualify a request, because a proxy is exactly what must not be
 * in the path — `X-Forwarded-Host` especially, since `Request#host` honours it
 * (`rawHostWithPort`, mirroring Rails' `raw_host_with_port`) and a client that
 * sent `X-Forwarded-Host: 127.0.0.1` would otherwise read as loopback.
 */
const FORWARDED_HEADERS = [
  "HTTP_X_FORWARDED_FOR",
  "HTTP_X_FORWARDED_HOST",
  "HTTP_X_FORWARDED_PROTO",
  "HTTP_X_FORWARDED_PORT",
  "HTTP_FORWARDED",
];

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1", "[::1]"];

/** `example.com:8080` → `example.com`, `[::1]:8080` → `[::1]`. */
function stripPort(host: string): string {
  if (host.startsWith("[")) return host.replace(/\]:\d+$/, "]");
  return host.replace(/^([^:]*):\d+$/, "$1");
}

/**
 * Requests that reach trailmap arrive over one of two paths:
 *
 * - the public hostname, proxied by dokku's nginx, which sets the
 *   `X-Forwarded-*` family;
 * - loopback on the box, straight to the container's published port, with no
 *   forwarding headers at all.
 *
 * The JSON API is for the second audience only — the CLI and ringo's Go
 * process — so anything carrying proxy provenance is refused, and the host is
 * read from the raw `Host` header rather than from `request.host`, which a
 * client-supplied `X-Forwarded-Host` can steer. `request.local` cannot stand
 * in for either check: docker's userland proxy rewrites the source address, so
 * even a loopback request arrives from the bridge gateway.
 */
export function isLoopbackRequest(request: LoopbackRequest): boolean {
  for (const header of FORWARDED_HEADERS) {
    const value = request.getHeader(header);
    if (value != null && String(value).trim() !== "") return false;
  }

  const host = request.getHeader("HTTP_HOST");
  if (host == null) return false;
  return LOOPBACK_HOSTS.includes(stripPort(String(host).trim().toLowerCase()));
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
