import { describe, it, expect } from "vitest";
import { RouteSet, controllerConstants } from "@blazetrails/actionpack";
import { Trails } from "@blazetrails/trailties";
import "../config/application.js";
import "../config/routes.js";
import { DashboardController } from "../app/controllers/dashboard-controller.js";
import { HealthController } from "../app/controllers/health-controller.js";
import { HomeController } from "../app/controllers/home-controller.js";
import { MutationsController } from "../app/controllers/mutations-controller.js";
import { ReadModelsController } from "../app/controllers/read-models-controller.js";
import { RfcPagesController } from "../app/controllers/rfc-pages-controller.js";
import { StoriesController } from "../app/controllers/stories-controller.js";
import { StoryPagesController } from "../app/controllers/story-pages-controller.js";

// `recognizePath` resolves a route's controller to its class and refuses a
// route whose controller does not exist, as Rails' `recognize_path` does by
// autoloading the constant. trails has no autoloader: the application
// registers every class under `app/controllers` at boot (the
// `setup_main_autoloader` initializer). This suite draws routes without
// booting, so it does that registration itself — which also makes each case a
// check that the route names a controller that is really there.
for (const controller of [
  DashboardController,
  HealthController,
  HomeController,
  MutationsController,
  ReadModelsController,
  RfcPagesController,
  StoriesController,
  StoryPagesController,
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

  it("routes the health endpoint to health#show", () => {
    const match = recognize(routeSet(), "GET", "/up");

    expect(match?.route.controller).toBe("health");
    expect(match?.route.action).toBe("show");
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
      ["/stories/next-bundle", "next_bundle"],
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
      ["/stories/in-progress", "in_progress"],
      ["/stories/done", "done"],
      ["/stories/record-spawn", "record_spawn"],
      ["/stories/block", "block"],
      ["/stories/close", "close"],
      ["/stories/status-set", "status_set"],
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
});
