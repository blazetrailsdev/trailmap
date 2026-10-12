import { afterEach, describe, expect, it } from "vitest";
import { setEnv } from "@blazetrails/ruby-compat";
import { FLEET_CONTROLS, FLEET_PANE_PATH, FLEET_REVIEWERS_PATH, SCREEN_HASH_MAX, fleetRepos, isPaneId, isScreenHash } from "../../config/fleet.js";

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

// `ringoBase` is NOT here. There is one ringo and one resolver for it,
// `Setting.ringoBase()` (app/models/setting.ts); its cases live with it in
// test/models/hub-models.test.ts, including the ones that used to be this
// file's — an unset variable, a blank one, and the trailing slash.

describe("FLEET_CONTROLS", () => {
  it("lists exactly the endpoints the page has a button for", () => {
    expect([...FLEET_CONTROLS].sort()).toEqual([
      "broadcast",
      "ci-fixer/spawn",
      "merge-pr",
      "reviewer/assign",
      "spawn",
      "spawnloop/dismiss",
      "spawnloop/dismiss-failed",
      "worker/spawn",
    ]);
  });
});

describe("isPaneId", () => {
  it("accepts a tmux pane id's digits, and nothing else", () => {
    for (const id of ["0", "42", "1234567890"]) expect(isPaneId(id), id).toBe(true);
    for (const id of ["", "%42", "4x", " 42", "42\n", "-1", "4.2", "../42", "12345678901", "٤٢"]) {
      expect(isPaneId(id), JSON.stringify(id)).toBe(false);
    }
  });

  it("names the relay's prefix on trailmap's own origin", () => {
    expect(FLEET_PANE_PATH).toBe("/fleet/pane");
  });
});

describe("FLEET_REVIEWERS_PATH", () => {
  // The page reads this off `#fleetConfig` and the route draws it; the three
  // have to be the same string, and this is the one they are all taken from.
  it("is where the page polls for each PR's reviewer, on trailmap's own origin", () => {
    expect(FLEET_REVIEWERS_PATH).toBe("/fleet/reviewers");
  });
});

describe("isScreenHash", () => {
  it("accepts any hash up to the cap, and the absence of one", () => {
    expect(isScreenHash("")).toBe(true);
    expect(isScreenHash("abc+/=1")).toBe(true);
    expect(isScreenHash("a".repeat(SCREEN_HASH_MAX))).toBe(true);
    expect(isScreenHash("a".repeat(SCREEN_HASH_MAX + 1))).toBe(false);
  });
});
