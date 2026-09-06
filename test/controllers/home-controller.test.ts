import { describe, it, expect, beforeAll } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { HomeController } from "../../app/controllers/home-controller.js";

/**
 * The engine's `add_view_paths` initializer prepends `app/views` at boot; a
 * controller test constructs the controller directly, so it has to say so.
 */
beforeAll(() => {
  (ApplicationController as unknown as { prependViewPath(path: string): void }).prependViewPath("app/views");
});

async function renderIndex(): Promise<string> {
  const tc = new ActionController.TestCase(HomeController);
  await tc.get("index");
  return tc.responseBody;
}

describe("HomeController", () => {
  it("renders through the application layout", async () => {
    const body = await renderIndex();

    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain('<link rel="stylesheet" href="/assets/stylesheets/application.css">');
  });

  it("renders the header, the task-domain nav and the footer", async () => {
    const body = await renderIndex();

    expect(body).toContain('<header class="site-header">');
    expect(body).toContain('<a href="/rfcs">RFCs</a>');
    expect(body).toContain('<a href="/backlog">Backlog</a>');
    expect(body).toContain('<main class="site-main">');
    expect(body).toContain('<footer class="site-footer">');
  });

  it("renders more than the placeholder heading", async () => {
    const body = await renderIndex();

    expect(body).toContain("<h1>trailmap</h1>");
    expect(body).toContain('<a href="/backlog">Backlog</a>');
    expect(body).toContain('<span class="badge s-ready">ready</span>');
  });
});
