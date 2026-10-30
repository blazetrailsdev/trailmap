/**
 * Boot the application, render one template that calls an `app/helpers`
 * method, and print what came out.
 *
 *     NODE_ENV=test tsx scripts/app-helpers-probe.ts
 *     => {"status":200,"body":"<p>a <strong>bold</strong> claim</p>\n"}
 *
 * A script rather than a test body because the thing being proven is wired at
 * BOOT: `action_controller.set_helpers_path` reads `app/helpers` off disk and
 * hands it to every controller. `test/helpers/app-helpers-in-views.test.ts`
 * runs this under tsx, the way the server itself runs, and reads the line it
 * prints.
 *
 * The template is a fixture (`test/fixtures/views/helper-probes`), not an
 * application view: no page has been moved onto a helper yet.
 */
import "../config/environment.ts";
import { exit } from "@blazetrails/ruby-compat";
import { ApplicationController } from "../app/controllers/application-controller.ts";
import { controllerTestCase } from "../test/support/controller-test-case.ts";

class HelperProbesController extends ApplicationController {
  async show(): Promise<void> {
    await this.render({ layout: false });
  }
}
HelperProbesController.prependViewPath("test/fixtures/views");

const tc = await controllerTestCase(HelperProbesController);
await tc.get("show");
console.log(JSON.stringify({ status: tc.response.status, body: tc.response.body }));
exit(0);
