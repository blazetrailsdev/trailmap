import { beforeAll, describe, expect, it } from "vitest";
import { setEnv } from "@blazetrails/ruby-compat";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { PanesController } from "../../app/controllers/panes-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

/**
 * `/panes/<n>`, the live view of one tmux pane.
 *
 * Like the fleet page it reads nothing itself: the screen arrives by polling
 * `FleetController#screen`. So what there is to assert is the shell — the
 * elements the script fills, and that it is pointed at trailmap's relay.
 */
async function show(id: string) {
  const tc = await controllerTestCase(PanesController);
  await tc.get("show", { params: { id } });
  return tc.response;
}

beforeAll(() => {
  ApplicationController.prependViewPath("app/views");
});

describe("PanesController", () => {
  it("renders the pane's page through the application layout", async () => {
    const response = await show("42");

    expect(response.status).toBe(200);
    expect(response.body).toContain("<!DOCTYPE html>");
    expect(response.body).toContain('<nav class="nav">');
    expect(response.body).toContain('<code class="pane-id">%42</code>');
  });

  it("points the script at trailmap's relay for this pane, never at ringo", async () => {
    setEnv("RINGO_BASE", "http://btwhooks.web:8080");
    try {
      const body = (await show("42")).body;

      expect(body).toContain('data-screen-path="/fleet/pane/42/screen"');
      expect(body).not.toContain("btwhooks.web");
      expect(body).not.toContain("No fleet data");
    } finally {
      setEnv("RINGO_BASE", undefined);
    }
  });

  it("declares everything the script fills in, and the terminal panel", async () => {
    const body = (await show("42")).body;

    for (const id of ["paneWorktree", "paneStatus", "paneUpdated", "paneNotice", "panePause"]) {
      expect(body).toContain(`id="${id}"`);
    }
    expect(body).toContain('<pre id="paneScreen" class="terminal"');
    expect(body).toContain("last ~2000 rows");
    // Logical name only; scripts/smoke-boot.sh guards the digested link.
    expect(body).toMatch(/<script src="[^"]*\/javascripts\/pane\.js" type="module"><\/script>/);
  });

  it("says so on the page when no ringo is configured", async () => {
    expect((await show("42")).body).toContain("No fleet data");
  });

  it("answers 404 for an id that is not a pane's digits", async () => {
    for (const id of ["%42", "abc", "4x", "<script>"]) {
      const response = await show(id);

      expect(response.status, id).toBe(404);
      expect(response.body).not.toContain("<script>");
    }
  });
});
