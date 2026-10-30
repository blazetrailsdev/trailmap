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
 * The routes are the application's own, loaded by the boot in
 * `test/support/boot.ts`, so a test fails if the action it calls
 * is not routed — as it would in Rails. A controller that exists only inside
 * a test has no route there, and gets a route set of its own with one
 * catch-all, so nothing a test needs is ever drawn into the application's.
 *
 * Request headers go on the request before the call, as rack env keys, which
 * is where the framework's own tests put them: `headers` here is the
 * convenience of writing `Host` instead of `HTTP_HOST`.
 */
import { ActionController, RouteSet } from "@blazetrails/actionpack";
import { Trails } from "@blazetrails/trailties";
import "./boot.ts";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { getFs } from "@blazetrails/ruby-compat";
import { STYLESHEET, boxRules, classListsIn, collisionsInList, type BoxRules } from "../../scripts/class-collisions.ts";

let rules: Promise<BoxRules> | undefined;

/**
 * Every page any controller test renders is held to the class-collision rule
 * (`scripts/class-collisions.ts`), so the rendered class lists of every `.tse`
 * page family are checked by the tests that already build its data — the
 * repo tabs and owner page included, under `HUB_TEST_DATABASE_URL`.
 */
async function assertNoClassCollisions(tc: ActionController.TestCase): Promise<void> {
  const body = String(tc.response.body ?? "");
  if (!body.includes("<html")) return;
  rules ??= getFs().readFile(STYLESHEET, "utf8").then(boxRules);
  const box = await rules;
  const found = classListsIn(body).flatMap((list) => collisionsInList(list, box));
  if (found.length) throw new Error(`class collision in ${tc.request.path}: ${[...new Set(found)].join(", ")}`);
}

type Controller = Parameters<typeof ActionController.TestCase.tests>[0] & {
  name: string;
  controllerPath(): string;
  actionMethods(): string[];
};

export async function controllerTestCase(
  controller: Controller,
  headers: Record<string, string> = {},
): Promise<ActionController.TestCase> {
  class ControllerTest extends ActionController.TestCase {}
  ControllerTest.tests(controller);
  const tc = new ControllerTest(`${controller.name}Test`);
  await tc.beforeSetup();
  const get = tc.get.bind(tc);
  tc.get = async (...args: Parameters<typeof get>) => {
    const answer = await get(...args);
    await assertNoClassCollisions(tc);
    return answer;
  };

  const application = Trails.application!.routes();
  const routed = [...application.routes].some(
    (route) => route.defaults.controller === controller.controllerPath(),
  );
  if (routed) {
    tc.routes = application;
  } else {
    tc.routes = new RouteSet();
    // One route per action, never a `:action` segment: Rails 8.0 deprecates a
    // dynamic `:action` (mapper.rb `add_route`) and 8.1 removes it.
    const path = controller.controllerPath();
    const actions = controller.actionMethods();
    tc.routes.draw(function () {
      for (const action of actions) this.get(`__test/${path}/${action}`, { controller: path, action });
    });
  }

  for (const [name, value] of Object.entries(headers)) {
    tc.request.setHeader(`HTTP_${name.toUpperCase().replace(/-/g, "_")}`, value);
  }
  return tc;
}
