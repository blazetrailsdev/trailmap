import { ApplicationController } from "./application-controller.js";

/**
 * `/up` — the liveness probe dokku's `CHECKS` file polls after a deploy and
 * the restart policy leans on. Deliberately public and dependency-free: it
 * answers as soon as the application has booted, so "the process is up" is
 * never confused with "the database is reachable".
 */
export class HealthController extends ApplicationController {
  show(): void {
    this.render({ json: { status: "ok" } });
  }
}
