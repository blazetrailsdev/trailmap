import { describe, it, expect } from "vitest";
import { RouteSet, controllerConstants } from "@blazetrails/actionpack";
import { Trails } from "@blazetrails/trailties";
import "../config/application.js";
import "../config/routes.js";
import { AuditsController } from "../app/controllers/audits-controller.js";
import { DashboardController } from "../app/controllers/dashboard-controller.js";
import { FleetController } from "../app/controllers/fleet-controller.js";
import { HomeController } from "../app/controllers/home-controller.js";
import { MutationsController } from "../app/controllers/mutations-controller.js";
import { ProbesController } from "../app/controllers/probes-controller.js";
import { PanesController } from "../app/controllers/panes-controller.js";
import { ReadModelsController } from "../app/controllers/read-models-controller.js";
import { RfcPagesController } from "../app/controllers/rfc-pages-controller.js";
import { StoriesController } from "../app/controllers/stories-controller.js";
import { StoryPagesController } from "../app/controllers/story-pages-controller.js";
import { OwnersController } from "../app/controllers/owners-controller.js";
import { RepoActionsController } from "../app/controllers/repo-actions-controller.js";
import { RepoCodeController } from "../app/controllers/repo-code-controller.js";
import { RepoInsightsController } from "../app/controllers/repo-insights-controller.js";
import { RepoIssuesController } from "../app/controllers/repo-issues-controller.js";
import { RepoProjectsController } from "../app/controllers/repo-projects-controller.js";
import { RepoPullsController } from "../app/controllers/repo-pulls-controller.js";
import { RepoSettingsController } from "../app/controllers/repo-settings-controller.js";
import { RepoWikiController } from "../app/controllers/repo-wiki-controller.js";
import { RESERVED_OWNER_NAMES } from "../config/routes.js";

// `recognizePath` resolves a route's controller to its class and refuses a
// route whose controller does not exist, as Rails' `recognize_path` does by
// autoloading the constant. trails has no autoloader: the application
// registers every class under `app/controllers` at boot (the
// `setup_main_autoloader` initializer). This suite draws routes without
// booting, so it does that registration itself — which also makes each case a
// check that the route names a controller that is really there.
for (const controller of [
  AuditsController,
  DashboardController,
  FleetController,
  HomeController,
  MutationsController,
  PanesController,
  ProbesController,
  ReadModelsController,
  RfcPagesController,
  StoriesController,
  StoryPagesController,
  OwnersController,
  RepoCodeController,
  RepoIssuesController,
  RepoPullsController,
  RepoActionsController,
  RepoProjectsController,
  RepoWikiController,
  RepoInsightsController,
  RepoSettingsController,
]) {
  controllerConstants.set(controller.controllerPath(), controller);
}

/** The application's route set, drawn by `config/routes.ts` when it loaded. */
function routeSet(): RouteSet {
  return Trails.application!.routes();
}

/**
 * Where a request goes: Rails' `recognize_path`, in the shape these cases
 * read. It raises when nothing matches, so an unrouted path fails its test
 * loudly rather than as an `undefined` three assertions later.
 */
function recognize(
  routes: RouteSet,
  method: string,
  path: string,
): { route: { controller: unknown; action: unknown }; params: Record<string, unknown> } {
  const params = routes.recognizePath(path, { method });
  return { route: { controller: params.controller, action: params.action }, params };
}

describe("config/routes", () => {
  it("routes the dashboard root to home#index", () => {
    const match = recognize(routeSet(), "GET", "/");

    expect(match?.route.controller).toBe("home");
    expect(match?.route.action).toBe("index");
  });

  // The framework's controller, which `@blazetrails/trailties` registers
  // itself: it is deliberately absent from the list above.
  it("routes the health endpoint to rails/health#show", () => {
    const match = recognize(routeSet(), "GET", "/up");

    expect(match?.route.controller).toBe("rails/health");
    expect(match?.route.action).toBe("show");
  });

  it("routes the readiness and deep probes beside it, to probes", () => {
    const routes = routeSet();

    expect(recognize(routes, "GET", "/up/ready").route).toEqual({
      controller: "probes",
      action: "ready",
    });
    expect(recognize(routes, "GET", "/up/deep").route).toEqual({
      controller: "probes",
      action: "deep",
    });
  });

  it("routes the plural list paths to the same page controllers", () => {
    const routes = routeSet();

    const rfcs = recognize(routes, "GET", "/rfcs");
    expect(rfcs?.route.controller).toBe("rfc_pages");
    expect(rfcs?.route.action).toBe("index");

    const backlog = recognize(routes, "GET", "/backlog");
    expect(backlog?.route.controller).toBe("story_pages");
    expect(backlog?.route.action).toBe("index");
  });

  it("routes the fleet dashboard, which is not the root", () => {
    const routes = routeSet();

    const dashboard = recognize(routes, "GET", "/dashboard");
    expect(dashboard?.route.controller).toBe("dashboard");
    expect(dashboard?.route.action).toBe("index");

    // ringo keeps serving its own `/` until this page is verified, so
    // trailmap's root is still its landing page.
    expect(recognize(routes, "GET", "/")?.route.controller).toBe("home");
  });

  it("routes audits as a resource whose id is the whole filename", () => {
    const routes = routeSet();

    expect(recognize(routes, "GET", "/audits").route).toEqual({ controller: "audits", action: "index" });

    // The extension is part of the id, not a `.md` format.
    const show = recognize(routes, "GET", "/audits/a-tie.md");
    expect(show.route).toEqual({ controller: "audits", action: "show" });
    expect(show.params.id).toBe("a-tie.md");
    expect(show.params.format).toBeUndefined();

    const raw = recognize(routes, "GET", "/audits/b-tie.html/raw");
    expect(raw.route).toEqual({ controller: "audits", action: "raw" });
    expect(raw.params.id).toBe("b-tie.html");
  });

  it("refuses a path traversal, a dotfile and any name auditFileRe rejects", () => {
    const routes = routeSet();
    for (const path of [
      "/audits/..%2Fsecret.md",
      "/audits/.hidden.md",
      "/audits/notes.txt",
      "/audits/view",
      "/audits/..%2Fsecret.md/raw",
      "/audits/.hidden.md/raw",
      "/audits/view/..%2Fsecret.md",
      "/audits/view/.hidden.md",
    ]) {
      expect(() => recognize(routes, "GET", path), path).toThrow(/No route matches/);
    }
  });

  it("redirects ringo's viewer url to the audit's raw url", async () => {
    const env = (path: string) => ({
      REQUEST_METHOD: "GET",
      PATH_INFO: path,
      SERVER_NAME: "example.com",
      SERVER_PORT: "80",
      "rack.url_scheme": "http",
    });
    const [status, headers] = await routeSet().call(env("/audits/view/a-tie.md"));
    expect(status).toBe(301);
    expect(headers["location"]).toBe("http://example.com/audits/a-tie.md/raw");

    const [refused] = await routeSet().call(env("/audits/view/.hidden.md"));
    expect(refused).toBe(404);
  });

  it("routes a pane's live view, and the screen relay it polls", () => {
    const routes = routeSet();

    const page = recognize(routes, "GET", "/panes/42");
    expect(page.route).toEqual({ controller: "panes", action: "show" });
    expect(page.params.id).toBe("42");

    const screen = recognize(routes, "GET", "/fleet/pane/42/screen");
    expect(screen.route).toEqual({ controller: "fleet", action: "screen" });
    expect(screen.params.id).toBe("42");
  });

  it("routes the reviewer relay the PR rows poll", () => {
    const routes = routeSet();

    const reviewers = recognize(routes, "GET", "/fleet/reviewers");
    expect(reviewers.route).toEqual({ controller: "fleet", action: "reviewers" });
    const usage = recognize(routes, "GET", "/fleet/read/codex-usage");
    expect(usage.route).toEqual({ controller: "fleet", action: "read" });
    expect(usage.params.name).toBe("codex-usage");
  });

  it("routes the singular show-page paths to their page controllers", () => {
    const routes = routeSet();

    const rfc = recognize(routes, "GET", "/rfc/0136-trailmap");
    expect(rfc?.route.controller).toBe("rfc_pages");
    expect(rfc?.route.action).toBe("show");
    expect(rfc?.params.id).toBe("0136-trailmap");

    const story = recognize(routes, "GET", "/story/render-the-rfc-and-story-show-pages");
    expect(story?.route.controller).toBe("story_pages");
    expect(story?.params.id).toBe("render-the-rfc-and-story-show-pages");
  });

  it("keeps the plural stories JSON routes distinct from the show pages", () => {
    const routes = routeSet();

    expect(recognize(routes, "GET", "/stories/anything")?.route.controller).toBe("stories");
    expect(recognize(routes, "GET", "/story/anything")?.route.controller).toBe("story_pages");
  });

  it("routes each read verb to the stories controller", () => {
    const routes = routeSet();
    const verbs: [string, string][] = [
      ["/stories", "index"],
      ["/stories/ready", "ready"],
      ["/stories/next-bundle", "nextBundle"],
      ["/stories/touching", "touching"],
    ];

    for (const [path, action] of verbs) {
      const match = recognize(routes, "GET", path);
      expect(match?.route.controller).toBe("stories");
      expect(match?.route.action).toBe(action);
    }
  });

  it("routes the whole read-models to the read_models controller", () => {
    const routes = routeSet();

    expect(recognize(routes, "GET", "/index")?.route.controller).toBe("read_models");
    expect(recognize(routes, "GET", "/events")?.route.action).toBe("events");
  });

  it("routes each mutation verb to the mutations controller", () => {
    const routes = routeSet();
    const verbs: [string, string][] = [
      ["/stories/claim", "claim"],
      ["/stories/release", "release"],
      ["/stories/in-progress", "inProgress"],
      ["/stories/done", "done"],
      ["/stories/record-spawn", "recordSpawn"],
      ["/stories/block", "block"],
      ["/stories/close", "close"],
      ["/stories/status-set", "statusSet"],
      ["/stories/priority", "priority"],
    ];

    for (const [path, action] of verbs) {
      const match = recognize(routes, "POST", path);
      expect(match?.route.controller).toBe("mutations");
      expect(match?.route.action).toBe(action);
    }
  });

  // The mutation paths sit under `/stories/`, where `stories#show` also lives.
  // A GET of one must stay a `show` lookup rather than being recognized as the
  // verb — the method is the only thing separating them.
  it("keeps a GET of a mutation path on stories#show", () => {
    const match = recognize(routeSet(), "GET", "/stories/claim");

    expect(match?.route.controller).toBe("stories");
    expect(match?.route.action).toBe("show");
  });

  // The named routes are drawn first for exactly this reason: `/stories/ready`
  // is a well-formed story id as far as `stories/:id` is concerned.
  it("routes an id to stories#show without swallowing the named routes", () => {
    const match = recognize(routeSet(), "GET", "/stories/serve-the-read-verbs-as-json");

    expect(match?.route.action).toBe("show");
    expect(match?.params.id).toBe("serve-the-read-verbs-as-json");
  });
  // ──────────────── the GitHub-shaped hierarchy ────────────────

  it("routes an owner and a repository, and names the segments", () => {
    const routes = routeSet();

    const owner = recognize(routes, "GET", "/blazetrailsdev");
    expect(owner.route).toEqual({ controller: "owners", action: "show" });
    expect(owner.params.owner).toBe("blazetrailsdev");

    const repo = recognize(routes, "GET", "/blazetrailsdev/trails");
    expect(repo.route).toEqual({ controller: "repo_code", action: "show" });
    expect(repo.params.owner).toBe("blazetrailsdev");
    expect(repo.params.repo).toBe("trails");
  });

  it("routes each repo tab to its own controller", () => {
    const routes = routeSet();
    const tabs: [string, string, string][] = [
      ["/blazetrailsdev/trails/issues", "repo_issues", "index"],
      ["/blazetrailsdev/trails/pulls", "repo_pulls", "index"],
      ["/blazetrailsdev/trails/actions", "repo_actions", "index"],
      ["/blazetrailsdev/trails/projects", "repo_projects", "index"],
      ["/blazetrailsdev/trails/wiki", "repo_wiki", "index"],
      // `pulse`, as GitHub spells its Insights tab's path.
      ["/blazetrailsdev/trails/pulse", "repo_insights", "show"],
      ["/blazetrailsdev/trails/settings", "repo_settings", "show"],
    ];

    for (const [path, controller, action] of tabs) {
      const match = recognize(routes, "GET", path);
      expect(match.route, path).toEqual({ controller, action });
      expect(match.params.repo, path).toBe("trails");
    }
  });

  it("routes a member of the three resourceful tabs", () => {
    const routes = routeSet();

    const issue = recognize(routes, "GET", "/blazetrailsdev/trails/issues/a-story");
    expect(issue.route).toEqual({ controller: "repo_issues", action: "show" });
    expect(issue.params.id).toBe("a-story");

    const pull = recognize(routes, "GET", "/blazetrailsdev/trails/pulls/7228");
    expect(pull.route).toEqual({ controller: "repo_pulls", action: "show" });
    expect(pull.params.id).toBe("7228");

    const project = recognize(routes, "GET", "/blazetrailsdev/trails/projects/0136-trailmap");
    expect(project.route).toEqual({ controller: "repo_projects", action: "show" });
    expect(project.params.id).toBe("0136-trailmap");
  });

  // THE REGRESSION TEST for the owner route. `/:owner` matches one segment, so
  // every existing top-level page is ambiguous with an organization of that
  // name, and the only two things standing between them are the drawing order
  // and RESERVED_OWNER_NAMES. A page added above the hierarchy without being
  // reserved would pass the first and fail this.
  it("leaves every reserved top-level path with its own controller", () => {
    const routes = routeSet();
    const pages: [string, string][] = [
      ["/up", "rails/health"],
      ["/dashboard", "dashboard"],
      ["/rfcs", "rfc_pages"],
      ["/backlog", "story_pages"],
      ["/index", "read_models"],
      ["/events", "read_models"],
      ["/stories", "stories"],
      ["/rfc/0136-trailmap", "rfc_pages"],
      ["/story/a-story", "story_pages"],
      ["/panes/42", "panes"],
      ["/fleet/reviewers", "fleet"],
    ];

    for (const [path, controller] of pages) {
      expect(recognize(routes, "GET", path).route.controller, path).toBe(controller);
    }
  });

  it("refuses a reserved name as an owner rather than serving it as one", () => {
    const routes = routeSet();

    // `/rfcs` is a page, so `/rfcs/0136-trailmap` is NOT a repository under an
    // owner called `rfcs` — nothing matches it at all. Without the constraint
    // it would reach `repo_code#show` and 404 there, which is the same status
    // for the wrong reason: a `/rfcs/<id>` page added later would then be
    // shadowed silently.
    expect(() => recognize(routes, "GET", "/rfcs/0136-trailmap")).toThrow();

    for (const name of RESERVED_OWNER_NAMES) {
      let controller = "(unrouted)";
      try {
        controller = String(recognize(routes, "GET", `/${name}`).route.controller);
      } catch {
        // Not every reserved name is a route of its own — `assets` is served
        // by the asset middleware, `fleet` and `panes` only under a segment.
      }
      expect(controller, name).not.toBe("owners");
    }
  });

  it("refuses an owner segment that is not login-shaped", () => {
    const routes = routeSet();

    for (const bad of ["/-leading", "/trailing-", "/two--hyphens", "/has_underscore"]) {
      expect(() => recognize(routes, "GET", bad), bad).toThrow();
    }
  });
});
