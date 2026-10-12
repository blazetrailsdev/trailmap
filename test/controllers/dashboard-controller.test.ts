import { beforeAll, describe, expect, it } from "vitest";
import { setX } from "../support/config-x.js";
import { ActionController } from "@blazetrails/actionpack";
import { setEnv } from "@blazetrails/ruby-compat";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { DashboardController } from "../../app/controllers/dashboard-controller.js";
import { controllerTestCase } from "../support/controller-test-case.js";

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
  const tc = await controllerTestCase(DashboardController);
  await tc.get("index");
  return tc.response.body;
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
    for (const id of ["queueSection", "askBody", "usageBar", "codexUsageBar", "pokeBtn", "drainCodexStatus", "drainClaudeField"]) {
      expect(body).toContain(`id="${id}"`);
    }
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

  it("points the page at trailmap for both its stream and its controls", async () => {
    const body = await index();

    expect(body).toContain('data-socket-path="/fleet/socket"');
    expect(body).toContain('data-control-path="/fleet/control"');
    expect(body).toContain('data-reviewers-path="/fleet/reviewers"');
    expect(body).toContain('data-read-path="/fleet/read"');
    expect(body).toContain('id="slControls"');
    expect(body).not.toContain("ringo.example.com");
  });

  // The token itself is the layout's `csrf_meta_tags`, which render only with
  // forgery protection on, and a controller test runs with it off. So the tag
  // and the token are asserted by `scripts/smoke-boot.sh`, on a production
  // boot; here, only that the page no longer carries its own copy.
  it("does not hand the page a CSRF token of its own", async () => {
    expect(await index()).not.toContain("data-csrf-token");
  });

  it("says so on the page when no ringo is configured, and not otherwise", async () => {
    expect(await index()).toContain("No fleet data");

    setEnv("RINGO_BASE", "http://btwhooks.web:8080");
    try {
      const body = await index();

      expect(body).not.toContain("No fleet data");
      expect(body).not.toContain("btwhooks.web");
    } finally {
      setEnv("RINGO_BASE", undefined);
    }
  });

  it("renders the repo options from configuration, sorted by name", async () => {
    setX("fleet", "repoPaths", "blazetrailsdev/trails=/srv/trails, blazetrailsdev/tasks=/srv/tasks");
    try {
      const body = await index();

      expect(body).toContain('<option value="/srv/tasks">blazetrailsdev/tasks</option>');
      expect(body).toContain('<option value="/srv/trails">blazetrailsdev/trails</option>');
      expect(body.indexOf("/srv/tasks")).toBeLessThan(body.indexOf("/srv/trails"));
    } finally {
      setX("fleet", "repoPaths", undefined);
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
