import { ApplicationController } from "./application-controller.js";
import { FLEET_CONTROLS, ringoBase } from "../../config/fleet.js";
import { isWebSocketRequest, relayEvents, type RelaySocket } from "../../lib/fleet-relay.js";

/**
 * How long ringo has to answer a control. A merge waits on GitHub, so this is
 * generous; without it a hung ringo holds the request, and the button, forever.
 */
export const CONTROL_TIMEOUT_MS = 30_000;

/**
 * The fleet page's two lines to ringo, both through trailmap.
 *
 * ringo is another origin behind the same SSO, and neither its event stream
 * nor its control endpoints can be reached from a page served here. So the
 * page talks to trailmap, on trailmap's own origin and under trailmap's
 * authentication, and trailmap talks to ringo over the private network.
 *
 * This reverses `docs/fleet-dashboard.md`'s first decision, which kept
 * trailmap off the stream's path. The cost it named is real and accepted: a
 * trailmap restart drops every viewer's socket (the page reconnects), and
 * trailmap holds a connection per viewer.
 */
export class FleetController extends ApplicationController {
  /**
   * `GET /fleet/socket`, as a WebSocket handshake. The connection is taken
   * from the server (`rack.hijack`) and handed to the relay; whatever this
   * action renders after that is discarded by the handler.
   */
  async socket(): Promise<void> {
    const base = ringoBase();
    if (base === null) {
      await this.render({ plain: "RINGO_BASE is not set", status: 503 });
      return;
    }
    // A WebSocket handshake carries the viewer's SSO cookie from ANY page
    // that opens one, and no same-origin policy stops the opener reading the
    // frames. So the handshake has to name this site as its origin, as Action
    // Cable requires of its own (`connection/base.rb`, `allow_request_origin?`,
    // which also answers 404). A missing `Origin` is refused too: every
    // browser sends one on a WebSocket handshake.
    if (this.request.origin == null || this.request.origin !== this.request.baseUrl) {
      await this.render({ plain: "Page not found", status: 404 });
      return;
    }
    const env = this.request.env as Record<string, unknown>;
    const hijack = env["rack.hijack"];
    const request = {
      method: String(env["REQUEST_METHOD"] ?? "GET"),
      url: String(env["REQUEST_URI"] ?? "/"),
      headers: handshakeHeaders(env),
    };
    if (typeof hijack !== "function" || !isWebSocketRequest(request)) {
      await this.render({ plain: "This endpoint speaks WebSocket only", status: 426 });
      return;
    }
    relayEvents(hijack() as RelaySocket, request, `${base}/events`);
    await this.head("ok");
  }

  /**
   * `POST /fleet/control/<ringo path>`: forward one of the page's controls to
   * ringo and answer with ringo's status and text, which is what the button
   * shows.
   *
   * A state-changing request made with the viewer's SSO cookie, so it must
   * come from this page. The framework's forgery protection sees to that
   * before this action runs: `config/application.ts` loads the 8.0 defaults,
   * which turn `default_protect_from_forgery` on for every controller, so a
   * POST needs the page's CSRF token and an `Origin` that matches.
   */
  async control(): Promise<void> {
    const base = ringoBase();
    const path = String(this.params.get("path") ?? "");
    if (!FLEET_CONTROLS.includes(path)) {
      await this.render({ plain: "Not a fleet control", status: 404 });
      return;
    }
    if (base === null) {
      await this.render({ plain: "RINGO_BASE is not set", status: 503 });
      return;
    }

    const body = this.request.rawPost;
    const contentType = this.request.getHeader("CONTENT_TYPE");
    try {
      const response = await fetch(`${base}/${path}`, {
        method: "POST",
        signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
        ...(body === "" ? {} : { body }),
        ...(contentType ? { headers: { "content-type": String(contentType) } } : {}),
      });
      await this.render({ plain: await response.text(), status: response.status });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        const seconds = CONTROL_TIMEOUT_MS / 1000;
        await this.render({ plain: `ringo did not answer in ${seconds}s`, status: 504 });
        return;
      }
      const reason = error instanceof Error ? error.message : String(error);
      await this.render({ plain: `ringo is unreachable: ${reason}`, status: 502 });
    }
  }
}

/** The handshake headers the WebSocket driver reads, lower-cased, from the Rack env. */
function handshakeHeaders(env: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("HTTP_") && typeof value === "string") {
      headers[key.slice(5).toLowerCase().replace(/_/g, "-")] = value;
    }
  }
  return headers;
}
