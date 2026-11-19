import { ApplicationController } from "./application-controller.ts";
import {
  FLEET_CONTROL_PATH,
  FLEET_READ_PATH,
  FLEET_REVIEWERS_PATH,
  FLEET_SOCKET_PATH,
  type FleetRepo,
} from "../../config/fleet.ts";
import { Setting } from "../models/setting.ts";
import { Repository } from "../models/repository.ts";

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
  declare repos: FleetRepo[];
  declare missingCheckout: string | null;
  declare socketPath: string;
  declare controlPath: string;
  declare reviewersPath: string;
  declare readPath: string;
  declare relayConfigured: boolean;

  async index(): Promise<void> {
    this.repos = await Repository.spawnChoices();
    this.missingCheckout =
      this.repos.length === 0 ? await Repository.missingCheckout() : null;
    this.socketPath = FLEET_SOCKET_PATH;
    this.controlPath = FLEET_CONTROL_PATH;
    this.reviewersPath = FLEET_REVIEWERS_PATH;
    this.readPath = FLEET_READ_PATH;
    this.relayConfigured = (await Setting.ringoBase()) !== null;
    await this.render();
  }
}
