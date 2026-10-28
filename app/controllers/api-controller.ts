import { ExceptionWrapper } from "@blazetrails/actionpack";
import { include } from "@blazetrails/activesupport";
import { ApplicationController } from "./application-controller.ts";
import { LoopbackOnly } from "./concerns/loopback-only.ts";

/**
 * The loopback JSON API's base: `/stories/*`, the mutation verbs, the two
 * read models, and the `/up/ready` and `/up/deep` probes. Its clients are the tasks CLI and ringo's Go process, and both
 * parse every answer as JSON.
 *
 * A 500 HERE IS JSON, AND THAT IS A DECISION. trailmap is not `apiOnly`, so
 * since trails#7777 `DebugExceptions` follows Rails' `render_exception` and
 * answers an unhandled error with the HTML debug page (plain text for XHR)
 * whatever the client asked for — right for a page, and an unparseable body
 * for these two clients. So the API rescues its own errors, as a Rails API
 * mounted in a full application does, and the pages keep the framework's page.
 *
 * ONLY a 500. `Error` is the widest class `rescueFrom` can match (see
 * HealthController), and a handler runs before the framework maps an error to
 * a status — so one that answered everything would turn `RecordNotFound`'s
 * 404 and `ParameterMissing`'s 400 into 500s. Whatever `rescueResponses`
 * gives another status is raised again, and reaches that mapping untouched.
 */

export class ApiController extends ApplicationController {
  static {
    include(this, LoopbackOnly);
    this.rescueFrom(Error, { with: "renderServerError" });
  }

  private async renderServerError(error: Error): Promise<void> {
    if (new ExceptionWrapper(error).statusCode !== 500) throw error;
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
