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
 * The routes are the application's own. `config/application` registers the
 * application without booting it, and `config/routes` then draws into its
 * route set exactly as it does at boot, so a test fails if the action it calls
 * is not routed — as it would in Rails. A controller that exists only inside
 * a test has no route there, and gets a route set of its own with one
 * catch-all, so nothing a test needs is ever drawn into the application's.
 *
 * `app/helpers` is handed over here too. At boot that is
 * `action_controller.set_helpers_path` and the `helper(":all")` it triggers;
 * vitest cannot boot the application (scripts/app-helpers-probe.ts says why,
 * and proves the booted half), so the suite defines the same methods through
 * the same public `helper`, in its block form. A deliberate, temporary stand-in:
 * trails story `controller-tests-cannot-reach-app-helpers-without-booting`
 * (RFC 0142) tracks deleting it.
 *
 * Request headers go on the request before the call, as rack env keys, which
 * is where the framework's own tests put them: `headers` here is the
 * convenience of writing `Host` instead of `HTTP_HOST`.
 */
import { ActionController, RouteSet } from "@blazetrails/actionpack";
import { Trails } from "@blazetrails/trailties";
import "../../config/application.js";
import "../../config/routes.js";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { ApplicationHelper } from "../../app/helpers/application-helper.js";

ApplicationController.helper(function (this: object, mod?: object) {
  Object.assign(mod ?? this, ApplicationHelper);
});

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

  const application = Trails.application!.routes();
  const routed = [...application.routes].some(
    (route) => route.defaults.controller === controller.controllerPath(),
  );
  if (routed) {
    tc.routes = application;
  } else {
    tc.routes = new RouteSet();
    tc.routes.draw(function () {
      this.get(`__test/${controller.controllerPath()}/:action`, {
        controller: controller.controllerPath(),
      });
    });
  }

  for (const [name, value] of Object.entries(headers)) {
    tc.request.setHeader(`HTTP_${name.toUpperCase().replace(/-/g, "_")}`, value);
  }
  return tc;
}
