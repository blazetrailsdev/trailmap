import { describe, expect, it, onTestFinished } from "vitest";
import { ActionController, DebugExceptions, ExceptionWrapper } from "@blazetrails/actionpack";
import { RecordNotFound } from "@blazetrails/activerecord";
import { ReadModelsController } from "../../app/controllers/read-models-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";
import { Trails } from "@blazetrails/trailties";
import type { ErrorSubscriber } from "@blazetrails/activesupport";

/** Every report `Trails.error` receives during the test that calls it. */
function recordReports() {
  const reports: { error: Error; handled: boolean; severity: string; source: string }[] = [];
  const subscriber: ErrorSubscriber = {
    report(error, { handled, severity, source }) {
      reports.push({ error, handled, severity, source });
    },
  };
  Trails.error.subscribe(subscriber);
  onTestFinished(() => Trails.error.unsubscribe(subscriber));
  return reports;
}

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
  // The rescue keeps the error from the executor, which reports only what
  // escapes (Rails' executor.rb), so the rescue reports it: once, as handled,
  // and at severity error rather than the reporter's default for a handled one.
  it("is reported to Trails.error exactly once, as a handled error", async () => {
    const reports = recordReports();
    const tc = await controllerTestCase(FailingReadModelsController, { Host: "127.0.0.1" });
    await tc.get("index");

    expect(tc.response.status).toBe(500);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ handled: true, severity: "error", source: "api" });
    expect(reports[0]!.error.message).toBe("no such table: stories");
  });

  it("does not report an error it re-raises for the framework to map (404, 400)", async () => {
    const reports = recordReports();
    const key = "ActiveRecord::RecordNotFound";
    ExceptionWrapper.rescueResponses[key] = ":not_found";
    onTestFinished(() => void delete ExceptionWrapper.rescueResponses[key]);

    const tc = await controllerTestCase(MissingReadModelsController, { Host: "127.0.0.1" });
    await expect(tc.get("index")).rejects.toThrow(RecordNotFound);
    expect(reports).toEqual([]);
  });

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

describe("ApiController", () => {
  it("lists no helper among its actions", () => {
    const actions = [...ReadModelsController.actionMethods()];
    expect(actions).not.toContain("_renderServerError");
    expect(actions).not.toContain("_requireLoopback");
    expect(actions.filter((name) => name.startsWith("_"))).toEqual([]);
  });
});
