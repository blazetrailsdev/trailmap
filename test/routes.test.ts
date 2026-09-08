import { describe, it, expect } from "vitest";
import { RouteSet } from "@blazetrails/actionpack";
import { drawRoutes } from "../config/routes.js";

function routeSet(): RouteSet {
  const routes = new RouteSet();
  routes.draw((mapper) => drawRoutes(mapper));
  return routes;
}

describe("drawRoutes", () => {
  it("routes the dashboard root to home#index", () => {
    const match = routeSet().recognize("GET", "/");

    expect(match?.route.controller).toBe("home");
    expect(match?.route.action).toBe("index");
  });

  it("routes the health endpoint to health#show", () => {
    const match = routeSet().recognize("GET", "/up");

    expect(match?.route.controller).toBe("health");
    expect(match?.route.action).toBe("show");
  });

  it("routes the plural list paths to the same page controllers", () => {
    const routes = routeSet();

    const rfcs = routes.recognize("GET", "/rfcs");
    expect(rfcs?.route.controller).toBe("rfc_pages");
    expect(rfcs?.route.action).toBe("index");

    const backlog = routes.recognize("GET", "/backlog");
    expect(backlog?.route.controller).toBe("story_pages");
    expect(backlog?.route.action).toBe("index");
  });

  it("routes the fleet dashboard, which is not the root", () => {
    const routes = routeSet();

    const dashboard = routes.recognize("GET", "/dashboard");
    expect(dashboard?.route.controller).toBe("dashboard");
    expect(dashboard?.route.action).toBe("index");

    // ringo keeps serving its own `/` until this page is verified, so
    // trailmap's root is still its landing page.
    expect(routes.recognize("GET", "/")?.route.controller).toBe("home");
  });

  it("routes the singular show-page paths to their page controllers", () => {
    const routes = routeSet();

    const rfc = routes.recognize("GET", "/rfc/0136-trailmap");
    expect(rfc?.route.controller).toBe("rfc_pages");
    expect(rfc?.route.action).toBe("show");
    expect(rfc?.params.id).toBe("0136-trailmap");

    const story = routes.recognize("GET", "/story/render-the-rfc-and-story-show-pages");
    expect(story?.route.controller).toBe("story_pages");
    expect(story?.params.id).toBe("render-the-rfc-and-story-show-pages");
  });

  it("keeps the plural stories JSON routes distinct from the show pages", () => {
    const routes = routeSet();

    expect(routes.recognize("GET", "/stories/anything")?.route.controller).toBe("stories");
    expect(routes.recognize("GET", "/story/anything")?.route.controller).toBe("story_pages");
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
      const match = routes.recognize("GET", path);
      expect(match?.route.controller).toBe("stories");
      expect(match?.route.action).toBe(action);
    }
  });

  it("routes the whole read-models to the read_models controller", () => {
    const routes = routeSet();

    expect(routes.recognize("GET", "/index")?.route.controller).toBe("read_models");
    expect(routes.recognize("GET", "/events")?.route.action).toBe("events");
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
      const match = routes.recognize("POST", path);
      expect(match?.route.controller).toBe("mutations");
      expect(match?.route.action).toBe(action);
    }
  });

  // The mutation paths sit under `/stories/`, where `stories#show` also lives.
  // A GET of one must stay a `show` lookup rather than being recognized as the
  // verb — the method is the only thing separating them.
  it("keeps a GET of a mutation path on stories#show", () => {
    const match = routeSet().recognize("GET", "/stories/claim");

    expect(match?.route.controller).toBe("stories");
    expect(match?.route.action).toBe("show");
  });

  // The named routes are drawn first for exactly this reason: `/stories/ready`
  // is a well-formed story id as far as `stories/:id` is concerned.
  it("routes an id to stories#show without swallowing the named routes", () => {
    const match = routeSet().recognize("GET", "/stories/serve-the-read-verbs-as-json");

    expect(match?.route.action).toBe("show");
    expect(match?.params.id).toBe("serve-the-read-verbs-as-json");
  });
});
