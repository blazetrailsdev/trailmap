import { ApplicationController } from "./application-controller.js";
import {
  FLEET_CONTROL_PATH,
  FLEET_SOCKET_PATH,
  fleetRepos,
  ringoBase,
} from "../../config/fleet.js";

/**
 * `/dashboard` — the fleet dashboard, ported from ringo's `/`.
 *
 * ringo's version is `dashboard.ServeDashboard` (`webhook/dashboard.go:2348`):
 * one constant HTML string with a single `%s` in it. The port splits that into
 * the three things it always was — a controller that reads configuration, a
 * `.tse` that renders the shell, and a script that consumes the SSE envelope.
 *
 * The controller has nothing to read out of `tasks.db`, and that is the point:
 * every row on this page is Go-owned process state (tmux panes, the spawn
 * loop, webhook ingest) which RFC 0136's non-goals keep on Go. trailmap serves
 * the HTML; ringo keeps serving the stream.
 */
export class DashboardController extends ApplicationController {
  async index(): Promise<void> {
    await this.render({
      locals: {
        repos: fleetRepos(),
        socketPath: FLEET_SOCKET_PATH,
        controlPath: FLEET_CONTROL_PATH,
        relayConfigured: ringoBase() !== null,
      },
    });
  }
}
