import { describe, expect, it } from "vitest";
import { DebugExceptions } from "@blazetrails/actionpack";
import { ReadModelsController } from "../../app/controllers/read-models-controller.js";
import { controllerTestCase } from "../support/controller-test-case.js";

const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

/** An API action that raises: a subclass inherits the rescue, which is the thing under test. */
class FailingReadModelsController extends ReadModelsController {
  override async index(): Promise<void> {
    throw new Error("no such table: stories");
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

  // The middleware every page's error reaches, as the vendored build ships it.
  // Before trails#7777 it matched `Accept` by substring, and a browser — whose
  // header names application/xml — was answered with an `<error>` document.
  it("is the HTML page for a browser", async () => {
    const debug = new DebugExceptions(
      async () => {
        throw new Error("a page raised");
      },
      { showDetailedExceptions: true, showExceptions: true },
    );
    const [status, headers] = await debug.call({
      REQUEST_METHOD: "GET",
      PATH_INFO: "/rfcs",
      HTTP_ACCEPT: BROWSER_ACCEPT,
    });

    expect(status).toBe(500);
    expect(String(headers["content-type"])).toMatch(/^text\/html/);
  });
});
