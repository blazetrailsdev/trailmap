import { ApplicationController } from "./application-controller.js";
import { FLEET_CONTROLS, ringoBase } from "../../config/fleet.js";
import { isWebSocketRequest, relayEvents, type RelaySocket } from "../../lib/fleet-relay.js";

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
   * come from this page: the framework's forgery protection requires the
   * page's CSRF token (and a matching `Origin`) before this action runs.
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
        ...(body === "" ? {} : { body }),
        ...(contentType ? { headers: { "content-type": String(contentType) } } : {}),
      });
      await this.render({ plain: await response.text(), status: response.status });
    } catch (error) {
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
