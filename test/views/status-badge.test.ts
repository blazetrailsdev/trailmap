import { describe, it, expect } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

/**
 * The partial is rendered the way a page renders it — through a controller —
 * which is how a page will render it once the badge normalisation moves onto a
 * helper; see the comment at the head of the partial.
 *
 * The class name is load-bearing. A controller-level `render({ partial })`
 * prefixes the name with the controller path rather than parsing a prefix out
 * of it, so `SharedController` is what makes `"status-badge"` resolve to
 * `app/views/shared/_status-badge`.
 */
let badgeStatus: unknown = null;

class SharedController extends ApplicationController {
  async show(): Promise<void> {
    await this.render({ partial: "status-badge", locals: { status: badgeStatus }, layout: false });
  }
}

/**
 * `pnpm views` bakes `annotateRenderedViewWithFilenames` into the compiled
 * template from the env it boots under, so a build under development wraps the
 * partial in `<!-- BEGIN ... -->` / `<!-- END ... -->` and one under test does
 * not. The literals are emitted by `tseHandlerScope` in
 * `@blazetrails/trails-tsc/dist/plugins/tse.js` (`<!-- BEGIN ${id} -->` and
 * `<!-- END ${id} -->`), from `Base.annotateRenderedViewWithFilenames` as
 * `build-views.js` reads it at build time. The badge is the markup between
 * them, whichever build last ran.
 */
function withoutAnnotations(html: string): string {
  return html.replace(/<!-- (BEGIN|END) [^>]*-->\n?/g, "").trim();
}

async function renderBadge(status: unknown): Promise<string> {
  badgeStatus = status;
  const tc = await controllerTestCase(SharedController);
  await tc.get("show");
  return withoutAnnotations(tc.response.body);
}

describe("shared/_status-badge", () => {
  it("renders every story status", async () => {
    for (const status of ["draft", "ready", "claimed", "in-progress", "blocked", "done", "closed"]) {
      expect(await renderBadge(status)).toBe(`<span class="badge s-${status}">${status}</span>`);
    }
  });

  it("renders every RFC status", async () => {
    for (const status of ["draft", "active", "closed"]) {
      expect(await renderBadge(status)).toBe(`<span class="badge s-${status}">${status}</span>`);
    }
  });

  it("renders the unknown arm for a null status", async () => {
    expect(await renderBadge(null)).toBe('<span class="badge s-unknown">unknown</span>');
  });

  it("renders the unknown arm for a blank status", async () => {
    expect(await renderBadge("  ")).toBe('<span class="badge s-unknown">unknown</span>');
  });

  it("escapes a status that is not one of the known words", async () => {
    expect(await renderBadge("<script>")).toBe('<span class="badge s-&lt;script&gt;">&lt;script&gt;</span>');
  });
});
