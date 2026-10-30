import { describe, expect, it, onTestFinished } from "vitest";
import { ActionController, DebugExceptions, ExceptionWrapper } from "@blazetrails/actionpack";
import { RecordNotFound } from "@blazetrails/activerecord";
import { ReadModelsController } from "../../app/controllers/read-models-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

/** An API action that raises: a subclass inherits the rescue, which is the thing under test. */
class FailingReadModelsController extends ReadModelsController {
  override async index(): Promise<void> {
    throw new Error("no such table: stories");
  }
}

class MissingReadModelsController extends ReadModelsController {
  override async index(): Promise<void> {
    throw new RecordNotFound("no such story");
  }
}

/**
 * What a 500 looks like, to each of trailmap's two audiences. The decision is
 * written down on `ApiController`.
 */
describe("a 500", () => {
  it("is JSON from the loopback API, whatever the client accepts", async () => {
    for (const accept of ["application/json", BROWSER_ACCEPT, ""]) {
      const headers: Record<string, string> = { Host: "127.0.0.1" };
      if (accept !== "") headers.Accept = accept;
      const tc = await controllerTestCase(FailingReadModelsController, headers);
      await tc.get("index");

      expect(tc.response.status).toBe(500);
      expect(tc.response.mediaType).toBe("application/json");
      expect(JSON.parse(tc.response.body)).toEqual({
        error: "internal_server_error",
        message: "no such table: stories",
      });
    }
  });

  // A handler runs before the framework's status mapping, so it must not
  // answer what that mapping would have: the error is raised again, and under
  // `ActionController::TestCase` (no middleware) that means it propagates.
  it("leaves an error the framework maps to another status alone", async () => {
    // The ActiveRecord trailtie adds this mapping at boot, which vitest does
    // not do (test/support/controller-test-case.ts says why).
    const key = "ActiveRecord::RecordNotFound";
    ExceptionWrapper.rescueResponses[key] = ":not_found";
    onTestFinished(() => void delete ExceptionWrapper.rescueResponses[key]);
    expect(new ExceptionWrapper(new RecordNotFound("no such story")).statusCode).toBe(404);

    const tc = await controllerTestCase(MissingReadModelsController, { Host: "127.0.0.1" });
    await expect(tc.get("index")).rejects.toThrow(RecordNotFound);

    // One with a mapping of actionpack's own.
    const missing = new ActionController.ParameterMissing("id");
    expect(new ExceptionWrapper(missing).statusCode).toBe(400);
  });

  // The middleware every page's error reaches, as the vendored build ships it.
  // Before trails#7777 it matched `Accept` by substring, and a browser — whose
  // header names application/xml — was answered with an `<error>` document.
  it("is the HTML page for a browser", async () => {
    const debug = new DebugExceptions(async () => {
      throw new Error("a page raised");
    });
    const [status, headers] = await debug.call({
      "action_dispatch.show_detailed_exceptions": true,
      REQUEST_METHOD: "GET",
      PATH_INFO: "/rfcs",
      HTTP_ACCEPT: BROWSER_ACCEPT,
    });

    expect(status).toBe(500);
    expect(String(headers["content-type"])).toMatch(/^text\/html/);
  });
});
