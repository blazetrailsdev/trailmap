import { ApplicationController } from "./application-controller.js";
import { requireLoopback } from "./concerns/loopback-only.js";

/**
 * The loopback JSON API's base: `/stories/*`, the mutation verbs, and the two
 * read models. Its clients are the tasks CLI and ringo's Go process, and both
 * parse every answer as JSON.
 *
 * A 500 HERE IS JSON, AND THAT IS A DECISION. trailmap is not `apiOnly`, so
 * since trails#7777 `DebugExceptions` follows Rails' `render_exception` and
 * answers an unhandled error with the HTML debug page (plain text for XHR)
 * whatever the client asked for — right for a page, and an unparseable body
 * for these two clients. So the API rescues its own errors, as a Rails API
 * mounted in a full application does, and the pages keep the framework's page.
 *
 * `Error` is the widest class `rescueFrom` can match; see HealthController.
 */
export class ApiController extends ApplicationController {
  static {
    this.beforeAction(requireLoopback);
    this.rescueFrom(Error, { with: "renderServerError" });
  }

  private async renderServerError(error: Error): Promise<void> {
    // The rescue keeps the error from reaching the middleware that would have
    // logged it, so it is logged here. The message goes in the body too: the
    // audience is loopback only, and it is what the CLI prints.
    ApiController.logger?.error(`${error.name}: ${error.message}\n${error.stack ?? ""}`);
    await this.render({
      json: { error: "internal_server_error", message: error.message },
      status: 500,
    });
  }
}
