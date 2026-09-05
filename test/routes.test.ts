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

  // The named routes are drawn first for exactly this reason: `/stories/ready`
  // is a well-formed story id as far as `stories/:id` is concerned.
  it("routes an id to stories#show without swallowing the named routes", () => {
    const match = routeSet().recognize("GET", "/stories/serve-the-read-verbs-as-json");

    expect(match?.route.action).toBe("show");
    expect(match?.params.id).toBe("serve-the-read-verbs-as-json");
  });
});
