import { beforeAll, describe, expect, it } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { setEnv } from "@blazetrails/activesupport/process-adapter";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { DashboardController } from "../../app/controllers/dashboard-controller.js";

/**
 * `/dashboard`, the fleet dashboard ported from ringo's `/`.
 *
 * The page reads nothing out of `tasks.db` — every row arrives over ringo's
 * SSE stream — so what there is to assert is the shell: that it is a template
 * rendered through the layout, that its two configured pieces (the repo list
 * and the SSE endpoint) come from the environment, and that it declares the
 * sections the live envelope fills in.
 */
async function index(): Promise<string> {
  const tc = new ActionController.TestCase(DashboardController);
  await tc.get("index");
  return tc.responseBody;
}

beforeAll(() => {
  ApplicationController.prependViewPath("app/views");
});

describe("DashboardController", () => {
  it("renders through the application layout", async () => {
    const body = await index();

    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain('<link rel="stylesheet" href="/assets/stylesheets/application.css">');
    expect(body).toContain('<nav class="nav">');
  });

  it("declares every section the SSE envelope fills in", async () => {
    const body = await index();

    expect(body).toContain('id="repoSections"');
    expect(body).toContain('id="ciFixerPanel"');
    expect(body).toContain('id="mainCIPills"');
    expect(body).toContain('id="pullFailPill"');
    expect(body).toContain('id="agentPills"');
    expect(body).toContain('id="tmuxPill"');
    expect(body).toContain('id="eventsPill"');
  });

  it("reuses the shell's status vocabulary rather than re-declaring it", async () => {
    const body = await index();

    expect(body).not.toContain(":root");
    expect(body).not.toContain("--green-bg");
  });

  it("points the stream at ringo, from configuration", async () => {
    setEnv("RINGO_EVENTS_URL", "https://ringo.example.com/events");
    try {
      expect(await index()).toContain('data-events-url="https://ringo.example.com/events"');
    } finally {
      setEnv("RINGO_EVENTS_URL", undefined);
    }
  });

  it("defaults the stream to same-origin /events, as ringo spells it", async () => {
    expect(await index()).toContain('data-events-url="/events"');
  });

  it("renders the repo options from configuration, sorted by name", async () => {
    setEnv("FLEET_REPO_PATHS", "blazetrailsdev/trails=/srv/trails, blazetrailsdev/tasks=/srv/tasks");
    try {
      const body = await index();

      expect(body).toContain('<option value="/srv/tasks">blazetrailsdev/tasks</option>');
      expect(body).toContain('<option value="/srv/trails">blazetrailsdev/trails</option>');
      expect(body.indexOf("/srv/tasks")).toBeLessThan(body.indexOf("/srv/trails"));
    } finally {
      setEnv("FLEET_REPO_PATHS", undefined);
    }
  });

  it("says so rather than offering an empty select when no repos are configured", async () => {
    const body = await index();

    expect(body).toContain("no repos configured (FLEET_REPO_PATHS)");
    expect(body).not.toContain("<option value=\"/srv");
  });

  it("loads the client half as an external script, not an inline one", async () => {
    const body = await index();

    expect(body).toContain('<script src="/assets/javascripts/dashboard.js" type="module"></script>');
  });
});
