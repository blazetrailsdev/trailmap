import { afterEach, describe, expect, it } from "vitest";
import { setEnv } from "@blazetrails/ruby-compat";
import { FLEET_CONTROLS, fleetRepos, ringoBase } from "../../config/fleet.js";

/**
 * The dashboard's two configured pieces, unit-tested rather than only through
 * the page. `FLEET_REPO_PATHS` is a hand-written pair list, which is exactly
 * the sort of input a page assertion only ever exercises the happy path of.
 */
afterEach(() => {
  setEnv("FLEET_REPO_PATHS", undefined);
  setEnv("RINGO_BASE", undefined);
});

describe("fleetRepos", () => {
  it("parses `owner/repo=path` pairs", () => {
    setEnv("FLEET_REPO_PATHS", "blazetrailsdev/trails=/srv/trails");

    expect(fleetRepos()).toEqual([{ name: "blazetrailsdev/trails", path: "/srv/trails" }]);
  });

  it("sorts by name, so the list does not reorder between requests", () => {
    setEnv(
      "FLEET_REPO_PATHS",
      "blazetrailsdev/trails=/srv/trails,blazetrailsdev/tasks=/srv/tasks,blazetrailsdev/trailmap=/srv/trailmap",
    );

    expect(fleetRepos().map((repo) => repo.name)).toEqual([
      "blazetrailsdev/tasks",
      "blazetrailsdev/trailmap",
      "blazetrailsdev/trails",
    ]);
  });

  it("tolerates the spacing a hand-written list actually has", () => {
    setEnv("FLEET_REPO_PATHS", " blazetrailsdev/tasks = /srv/tasks , blazetrailsdev/trails=/srv/trails ");

    expect(fleetRepos()).toEqual([
      { name: "blazetrailsdev/tasks", path: "/srv/tasks" },
      { name: "blazetrailsdev/trails", path: "/srv/trails" },
    ]);
  });

  it("splits on the FIRST `=`, so a path containing one survives", () => {
    setEnv("FLEET_REPO_PATHS", "acme/app=/srv/a=b");

    expect(fleetRepos()).toEqual([{ name: "acme/app", path: "/srv/a=b" }]);
  });

  it("drops an entry with no `=`, or with either side empty", () => {
    setEnv("FLEET_REPO_PATHS", "blazetrailsdev/trails,=/srv/nameless,acme/app=,acme/ok=/srv/ok");

    expect(fleetRepos()).toEqual([{ name: "acme/ok", path: "/srv/ok" }]);
  });

  it("is empty when the variable is unset or blank", () => {
    expect(fleetRepos()).toEqual([]);

    setEnv("FLEET_REPO_PATHS", "   ");
    expect(fleetRepos()).toEqual([]);
  });
});

describe("ringoBase", () => {
  it("is null when the deployment names no ringo", () => {
    expect(ringoBase()).toBeNull();

    setEnv("RINGO_BASE", "   ");
    expect(ringoBase()).toBeNull();
  });

  it("is ringo's origin, trimmed and without a trailing slash", () => {
    setEnv("RINGO_BASE", "  http://btwhooks.web:8080/  ");

    expect(ringoBase()).toBe("http://btwhooks.web:8080");
  });
});

describe("FLEET_CONTROLS", () => {
  it("lists exactly the endpoints the page has a button for", () => {
    expect([...FLEET_CONTROLS].sort()).toEqual([
      "ci-fixer/spawn",
      "merge-pr",
      "spawn",
      "spawnloop/dismiss",
      "spawnloop/dismiss-failed",
    ]);
  });
});
