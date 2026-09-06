import { describe, it, expect } from "vitest";
import { AbstractController, ActionController, ActionView } from "@blazetrails/actionpack";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { ApplicationHelper } from "../../app/helpers/application-helper.js";
import { MarkdownHelper } from "../../app/helpers/markdown-helper.js";
import { helperModules } from "../../app/helpers/index.js";
import { includeAllHelpers } from "../../config/initializers/include-all-helpers.js";

/**
 * The two links that make `app/helpers` reachable: the include into the
 * controller, and the view context built from it.
 *
 * `FixtureResolver` stands in for `app/views` so the templates that exercise
 * the wiring live next to the assertions rather than being added to the app's
 * pages for the sake of a test. It compiles `.tse` at render time, which is
 * the same handler `app/views` goes through.
 */
function controllerWithViews(templates: Record<string, string>): typeof ApplicationController {
  class HelpersProbeController extends ApplicationController {
    index(): void {}
  }

  HelpersProbeController.prependViewPath(new ActionView.FixtureResolver(templates));

  return HelpersProbeController;
}

const LAYOUT = { "layouts/application.html.tse": "<body><%= yield %></body>" };

describe("app/helpers in the view context", () => {
  it("calls a helper method from a template", async () => {
    const controller = controllerWithViews({
      ...LAYOUT,
      "helpers_probe/index.html.tse": '<%= renderMarkdown("**hi**") %>',
    });

    const tc = new ActionController.TestCase(controller);
    await tc.get("index");

    expect(tc.responseBody).toBe("<body><p><strong>hi</strong></p></body>");
  });

  it("calls a helper method from a partial", async () => {
    const controller = controllerWithViews({
      ...LAYOUT,
      "helpers_probe/index.html.tse": '<%= render({ partial: "row" }) %>',
      "helpers_probe/_row.html.tse": '<%= renderMarkdown("*row*") %>',
    });

    const tc = new ActionController.TestCase(controller);
    await tc.get("index");

    expect(tc.responseBody).toContain("<em>row</em>");
  });

  // The helper returns a SafeBuffer, and a view that escaped it would render
  // the tags as text. Escaping is `<%=`'s job, so it is the view context —
  // not the helper — that this pins.
  it("does not escape a helper's SafeBuffer", async () => {
    const controller = controllerWithViews({
      ...LAYOUT,
      "helpers_probe/index.html.tse": '<%= renderMarkdown("a > b") %>',
    });

    const tc = new ActionController.TestCase(controller);
    await tc.get("index");

    expect(tc.responseBody).toContain("<p>a &gt; b</p>");
    expect(tc.responseBody).not.toContain("&lt;p&gt;");
  });
});

describe("includeAllHelpers", () => {
  it("includes every app/helpers module into ApplicationController", () => {
    includeAllHelpers();

    const helpers = AbstractController._helpersInstance.call(new ApplicationController());

    expect(typeof helpers.renderMarkdown).toBe("function");
  });

  it("leaves the framework's own helpers reachable", () => {
    includeAllHelpers();

    const helpers = AbstractController._helpersInstance.call(new ApplicationController());

    expect(typeof helpers.contentSecurityPolicyNonce).toBe("function");
  });
});

describe("helperModules", () => {
  // The barrel is hand-written, so a helper file that is never added to it is
  // the failure mode: the module exists, the view still cannot call it. This
  // pins the two that exist; a third has to be listed here to be wired.
  it("lists every module under app/helpers", () => {
    expect(helperModules).toEqual([ApplicationHelper, MarkdownHelper]);
  });

  it("carries only method bags, which is what withHelpers can splice", () => {
    for (const mod of helperModules) {
      for (const value of Object.values(mod)) {
        expect(typeof value).toBe("function");
      }
    }
  });
});
