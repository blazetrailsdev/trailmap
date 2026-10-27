import { describe, it, expect, beforeAll } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

beforeAll(() => {
  ApplicationController.prependViewPath("app/views");
});

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

async function renderBadge(status: unknown): Promise<string> {
  badgeStatus = status;
  const tc = await controllerTestCase(SharedController);
  await tc.get("show");
  return tc.response.body.trim();
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
