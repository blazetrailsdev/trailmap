/**
 * `ActionController::TestCase`, set up for one of trailmap's controllers.
 *
 * The framework's harness is Rails' now: a test CLASS that names its
 * controller with `tests`, an instance per test, a `beforeSetup` that builds
 * the request and response, and a route set the request is generated against.
 * Under vitest that is four lines of ceremony before the first `get`, and it
 * would otherwise be written out in every controller test and both page gates.
 *
 *     const tc = await controllerTestCase(RfcPagesController);
 *     await tc.get("index", { params: { status: "draft" } });
 *     tc.response.status; tc.response.body;
 *
 * The routes are the application's own (`config/routes.ts`), so a test fails
 * if the action it calls is not routed — as it would in Rails. A controller
 * that exists only inside a test has no route to find, so each call also adds
 * one catch-all for the controller under test; an application route, drawn
 * first, still wins.
 *
 * Request headers go on the request before the call, as rack env keys, which
 * is where the framework's own tests put them: `headers` here is the
 * convenience of writing `Host` instead of `HTTP_HOST`.
 */
import { ActionController, RouteSet } from "@blazetrails/actionpack";
import type { Mapper } from "@blazetrails/actionpack";
import { drawRoutes } from "../../config/routes.js";

type Controller = Parameters<typeof ActionController.TestCase.tests>[0] & {
  name: string;
  controllerPath(): string;
};

export async function controllerTestCase(
  controller: Controller,
  headers: Record<string, string> = {},
): Promise<ActionController.TestCase> {
  class ControllerTest extends ActionController.TestCase {}
  ControllerTest.tests(controller);
  const tc = new ControllerTest(`${controller.name}Test`);
  await tc.beforeSetup();

  tc.routes = new RouteSet();
  tc.routes.draw(function (this: Mapper) {
    drawRoutes(this);
    this.get(`__test/${controller.controllerPath()}/:action`, {
      controller: controller.controllerPath(),
    });
  });

  for (const [name, value] of Object.entries(headers)) {
    tc.request.setHeader(`HTTP_${name.toUpperCase().replace(/-/g, "_")}`, value);
  }
  return tc;
}
