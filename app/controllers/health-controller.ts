import { ApplicationController } from "./application-controller.js";

/**
 * `/up` — the liveness probe. `app.json` polls it after a deploy and the
 * restart policy leans on it.
 *
 * Rails' own `Rails::HealthController` renders a coloured HTML page; this one
 * answers JSON, because its callers are dokku's healthcheck and `curl`, not a
 * browser. What it keeps is the part that matters: `rescueFrom(Exception)`
 * answering 500, so the endpoint means "booted with no exceptions" rather than
 * merely "can route a request" — a supervisor that restarts on a red check
 * needs the check to be able to go red.
 *
 * It deliberately touches no dependency: a third-party outage should not
 * restart the application.
 *
 * `Error` is the widest class `rescueFrom` can match here; Rails names
 * `Exception`, which has no JS counterpart — a thrown non-Error value would
 * escape, and become a 500 from the framework instead of from this handler.
 */
export class HealthController extends ApplicationController {
  static {
    this.rescueFrom(Error, function (this: HealthController) {
      return this.renderDown();
    });
  }

  async show(): Promise<void> {
    await this.render({ json: { status: "ok" } });
  }

  private async renderDown(): Promise<void> {
    await this.render({ json: { status: "down" }, status: 500 });
  }
}
