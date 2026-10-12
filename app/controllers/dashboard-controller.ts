import { ApplicationController } from "./application-controller.js";
import {
  FLEET_CONTROL_PATH,
  FLEET_READ_PATH,
  FLEET_REVIEWERS_PATH,
  FLEET_SOCKET_PATH,
} from "../../config/fleet.js";
import { Setting } from "../models/setting.js";
import { Repository } from "../models/repository.js";

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
        repos: await Repository.spawnChoices(),
        socketPath: FLEET_SOCKET_PATH,
        controlPath: FLEET_CONTROL_PATH,
        reviewersPath: FLEET_REVIEWERS_PATH,
        readPath: FLEET_READ_PATH,
        relayConfigured: (await Setting.ringoBase()) !== null,
      },
    });
  }
}
