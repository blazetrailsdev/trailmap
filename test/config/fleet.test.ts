import { afterEach, describe, expect, it } from "vitest";
import { env } from "@blazetrails/activesupport/process-adapter";
import { fleetEventsUrl, fleetRepos } from "../../config/fleet.js";

/**
 * The dashboard's two configured pieces, unit-tested rather than only through
 * the page. `FLEET_REPO_PATHS` is a hand-written pair list, which is exactly
 * the sort of input a page assertion only ever exercises the happy path of.
 */
afterEach(() => {
  delete env.FLEET_REPO_PATHS;
  delete env.RINGO_EVENTS_URL;
});

describe("fleetRepos", () => {
  it("parses `owner/repo=path` pairs", () => {
    env.FLEET_REPO_PATHS = "blazetrailsdev/trails=/srv/trails";

    expect(fleetRepos()).toEqual([{ name: "blazetrailsdev/trails", path: "/srv/trails" }]);
  });

  it("sorts by name, so the list does not reorder between requests", () => {
    env.FLEET_REPO_PATHS =
      "blazetrailsdev/trails=/srv/trails,blazetrailsdev/tasks=/srv/tasks,blazetrailsdev/trailmap=/srv/trailmap";

    expect(fleetRepos().map((repo) => repo.name)).toEqual([
      "blazetrailsdev/tasks",
      "blazetrailsdev/trailmap",
      "blazetrailsdev/trails",
    ]);
  });

  it("tolerates the spacing a hand-written list actually has", () => {
    env.FLEET_REPO_PATHS = " blazetrailsdev/tasks = /srv/tasks , blazetrailsdev/trails=/srv/trails ";

    expect(fleetRepos()).toEqual([
      { name: "blazetrailsdev/tasks", path: "/srv/tasks" },
      { name: "blazetrailsdev/trails", path: "/srv/trails" },
    ]);
  });

  it("splits on the FIRST `=`, so a path containing one survives", () => {
    env.FLEET_REPO_PATHS = "acme/app=/srv/a=b";

    expect(fleetRepos()).toEqual([{ name: "acme/app", path: "/srv/a=b" }]);
  });

  it("drops an entry with no `=`, or with either side empty", () => {
    env.FLEET_REPO_PATHS = "blazetrailsdev/trails,=/srv/nameless,acme/app=,acme/ok=/srv/ok";

    expect(fleetRepos()).toEqual([{ name: "acme/ok", path: "/srv/ok" }]);
  });

  it("is empty when the variable is unset or blank", () => {
    expect(fleetRepos()).toEqual([]);

    env.FLEET_REPO_PATHS = "   ";
    expect(fleetRepos()).toEqual([]);
  });
});

describe("fleetEventsUrl", () => {
  it("defaults to same-origin /events, as ringo spells it", () => {
    expect(fleetEventsUrl()).toBe("/events");
  });

  it("takes an absolute ringo origin", () => {
    env.RINGO_EVENTS_URL = "https://ringo.example.com/events";

    expect(fleetEventsUrl()).toBe("https://ringo.example.com/events");
  });

  it("trims, and falls back rather than yielding an empty endpoint", () => {
    env.RINGO_EVENTS_URL = "  https://ringo.example.com/events  ";
    expect(fleetEventsUrl()).toBe("https://ringo.example.com/events");

    env.RINGO_EVENTS_URL = "   ";
    expect(fleetEventsUrl()).toBe("/events");
  });
});
