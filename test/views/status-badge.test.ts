import { describe, it, expect, beforeAll } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { ApplicationController } from "../../app/controllers/application-controller.js";

beforeAll(() => {
  (ApplicationController as unknown as { prependViewPath(path: string): void }).prependViewPath("app/views");
});

/**
 * The partial is rendered the way a page renders it — through a controller —
 * because that is the path the framework offers today: `app/helpers` never
 * reaches a view, see the comment at the head of the partial.
 *
 * The class name is load-bearing: the controller path is what the partial
 * lookup prefixes an unqualified name with, so `SharedController` is what
 * makes `"status-badge"` resolve to `app/views/shared/_status-badge`.
 */
let badgeStatus: unknown = null;

class SharedController extends ApplicationController {
  show(): void {
    (this as unknown as { render(options: unknown): void }).render({
      partial: "status-badge",
      locals: { status: badgeStatus },
      layout: false,
    });
  }
}

async function renderBadge(status: unknown): Promise<string> {
  badgeStatus = status;
  const tc = new ActionController.TestCase(SharedController);
  await tc.get("show");
  return tc.responseBody.trim();
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
});
