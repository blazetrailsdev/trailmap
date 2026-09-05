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
});
