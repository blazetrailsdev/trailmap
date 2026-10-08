import { ApplicationController } from "./application-controller.js";
import { FLEET_PANE_PATH, isPaneId, ringoBase } from "../../config/fleet.js";

/**
 * `/panes/<n>` — one agent's tmux pane, live in the browser and read-only.
 *
 * Like `/dashboard`, the controller reads nothing: the screen is Go-owned
 * process state. It renders the shell and tells the script where to poll,
 * which is `FleetController#screen` on this origin, never ringo itself.
 */
export class PanesController extends ApplicationController {
  async show(): Promise<void> {
    const id = String(this.params.get("id") ?? "");
    if (!isPaneId(id)) {
      await this.render({ plain: "Page not found", status: 404 });
      return;
    }
    await this.render({
      locals: {
        pane: `%${id}`,
        screenPath: `${FLEET_PANE_PATH}/${id}/screen`,
        relayConfigured: ringoBase() !== null,
      },
    });
  }
}
