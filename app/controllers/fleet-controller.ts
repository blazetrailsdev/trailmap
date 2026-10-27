import { ApplicationController } from "./application-controller.ts";
import { FLEET_CONTROLS, FLEET_READS, isPaneId, isScreenHash } from "../../config/fleet.ts";
import { Setting } from "../models/setting.ts";
import { isWebSocketRequest, relayEvents, type RelaySocket } from "../../lib/fleet-relay.ts";

/**
 * How long ringo has to answer a control. A merge waits on GitHub, so this is
 * generous; without it a hung ringo holds the request, and the button, forever.
 */
export const CONTROL_TIMEOUT_MS = 30_000;

/**
 * How long ringo has to answer for a pane's screen. Far shorter than a
 * control's: the pane page asks every two seconds, and an answer that takes
 * longer than the interval is already stale. A hung ringo should cost the
 * reader one missed frame, not a queue of held requests.
 */
export const SCREEN_TIMEOUT_MS = 1_500;

/**
 * How long ringo has to answer for the reviewer list. Between a control's
 * patience and a screen's: the page asks on a slow timer and can live one
 * cycle with yesterday's answer, but a hung ringo must not hold the request
 * long enough for the next poll to pile up behind it.
 */
export const REVIEWERS_TIMEOUT_MS = 5_000;

/**
 * The fleet pages' lines to ringo, all through trailmap.
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
    const base = await Setting.ringoBase();
    if (base === null) {
      await this.render({ plain: "no ringo origin is configured", status: 503 });
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
    const base = await Setting.ringoBase();
    const path = String(this.params.get("path") ?? "");
    if (!FLEET_CONTROLS.includes(path)) {
      await this.render({ plain: "Not a fleet control", status: 404 });
      return;
    }
    if (base === null) {
      await this.render({ plain: "no ringo origin is configured", status: 503 });
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
      await this.render(ringoFailure(error, CONTROL_TIMEOUT_MS));
    }
  }

  /**
   * `GET /fleet/reviewers`: ringo's `/reviewer/list`, relayed unchanged.
   *
   * The reviewer of a PR is not in the event envelope -- ringo's own
   * dashboard fetches it separately too (`dashboard.go:904`) -- so the fleet
   * page's reviewer pane rows need a read path of their own. Read-only, and
   * narrower than `control`: one fixed upstream path, no body, no allowlist to
   * keep in step.
   */
  async reviewers(): Promise<void> {
    await this.relayRead("reviewer/list");
  }

  /**
   * The page's other reads -- usage, relayed questions, a reviewer drain's
   * progress -- by the names in `FLEET_READS`, on the same terms as
   * `reviewers`. `agent` is the one query any of them takes, and only
   * `drain-status` takes it (`/reviewer/drain-status?agent=codex`); it is
   * forwarded there alone, and only as a bare word.
   */
  async read(): Promise<void> {
    const name = String(this.params.get("name") ?? "");
    if (!Object.hasOwn(FLEET_READS, name)) {
      await this.render({ plain: "Not a fleet read", status: 404 });
      return;
    }
    const agent = String(this.params.get("agent") ?? "");
    await this.relayRead(FLEET_READS[name] + (name === "drain-status" && /^[a-z]+$/.test(agent) ? `?agent=${agent}` : ""));
  }

  private async relayRead(path: string): Promise<void> {
    const base = await Setting.ringoBase();
    if (base === null) {
      await this.render({ plain: "no ringo origin is configured", status: 503 });
      return;
    }

    this.noStore();
    try {
      const response = await fetch(`${base}/${path}`, {
        signal: AbortSignal.timeout(REVIEWERS_TIMEOUT_MS),
      });
      const text = await response.text();
      if (response.ok) {
        await this.render({ json: text });
      } else {
        await this.render({ plain: text, status: response.status });
      }
    } catch (error) {
      await this.render(ringoFailure(error, REVIEWERS_TIMEOUT_MS));
    }
  }

  /**
   * `GET /fleet/pane/<n>/screen[?have=<hash>]`: one pane's current screen, as
   * ringo captured and rendered it. ringo owns tmux; this only relays, and
   * answers with ringo's own JSON.
   *
   * `<n>` is the tmux pane id without its `%`, and it is checked as digits
   * before anything is built from it: it becomes a path segment of a request
   * to a process on the private network.
   */
  async screen(): Promise<void> {
    const id = String(this.params.get("id") ?? "");
    if (!isPaneId(id)) {
      await this.render({ plain: "Not a pane id", status: 400 });
      return;
    }
    const have = String(this.params.get("have") ?? "");
    if (!isScreenHash(have)) {
      await this.render({ plain: "Not a screen hash", status: 400 });
      return;
    }
    const base = await Setting.ringoBase();
    if (base === null) {
      await this.render({ plain: "no ringo origin is configured", status: 503 });
      return;
    }

    const query = have === "" ? "" : `?have=${encodeURIComponent(have)}`;
    this.noStore();
    try {
      const response = await fetch(`${base}/pane/${id}/screen${query}`, {
        signal: AbortSignal.timeout(SCREEN_TIMEOUT_MS),
      });
      const text = await response.text();
      if (response.ok) {
        await this.render({ json: text });
      } else if (saysPaneIsGone(text)) {
        // The contract is 200 for a gone pane. A ringo that says the same
        // thing under a 404 is still saying it, and the page must hear
        // "exited" rather than retry a dead pane as an outage forever. A 404
        // WITHOUT that body stays an error: it is what a ringo with no such
        // endpoint answers, for every pane, and those have not exited.
        await this.render({ json: { exists: false } });
      } else {
        await this.render({ plain: text, status: response.status });
      }
    } catch (error) {
      await this.render(ringoFailure(error, SCREEN_TIMEOUT_MS));
    }
  }
}

/** Whether ringo's body is its gone-pane answer, `{ "exists": false }`, whatever status it came under. */
function saysPaneIsGone(text: string): boolean {
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null && (body as { exists?: unknown }).exists === false;
  } catch {
    return false;
  }
}

/** 504 for a ringo that did not answer in time, 502 for one that could not be reached. */
export function ringoFailure(error: unknown, timeoutMs: number): { plain: string; status: number } {
  if (error instanceof Error && error.name === "TimeoutError") {
    return { plain: `ringo did not answer in ${timeoutMs / 1000}s`, status: 504 };
  }
  const reason = error instanceof Error ? error.message : String(error);
  return { plain: `ringo is unreachable: ${reason}`, status: 502 };
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
