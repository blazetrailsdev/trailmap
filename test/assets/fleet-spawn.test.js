import { describe, expect, it } from "vitest";
import { derivedName, modelOptions, moveRepo, orderRepos, repoChips, spawnKey, taskHeight } from "../../app/assets/javascripts/fleet-spawn.js";

const REPOS = [
  { name: "blazetrailsdev/trails", path: "/w/trails" },
  { name: "blazetrailsdev/trailmap", path: "/w/trailmap" },
  { name: "blazetrailsdev/tasks", path: "/w/tasks" },
];
const names = (repos) => repos.map((r) => r.name);

describe("orderRepos", () => {
  it("is the server's order with nothing saved", () => {
    expect(names(orderRepos(REPOS, null))).toEqual(names(REPOS));
    expect(names(orderRepos(REPOS, "garbage"))).toEqual(names(REPOS));
  });

  it("puts the saved names first, then the rest in the server's order, dropping names no longer offered", () => {
    expect(names(orderRepos(REPOS, ["blazetrailsdev/tasks", "gone/repo", "blazetrailsdev/tasks"]))).toEqual([
      "blazetrailsdev/tasks",
      "blazetrailsdev/trails",
      "blazetrailsdev/trailmap",
    ]);
  });
});

describe("moveRepo", () => {
  const order = names(REPOS);
  it("swaps a repo with its neighbour, and stops at either end", () => {
    expect(moveRepo(order, "blazetrailsdev/tasks", -1)).toEqual(["blazetrailsdev/trails", "blazetrailsdev/tasks", "blazetrailsdev/trailmap"]);
    expect(moveRepo(order, "blazetrailsdev/trails", -1)).toEqual(order);
    expect(moveRepo(order, "blazetrailsdev/tasks", 1)).toEqual(order);
    expect(moveRepo(order, "nope", 1)).toEqual(order);
  });
});

describe("spawnKey", () => {
  it("spawns on ⌘ or Ctrl+Enter, and leaves a bare Enter to the box", () => {
    expect(spawnKey({ key: "Enter", metaKey: true })).toEqual({ kind: "spawn" });
    expect(spawnKey({ key: "Enter", ctrlKey: true })).toEqual({ kind: "spawn" });
    expect(spawnKey({ key: "Enter" })).toBeNull();
    expect(spawnKey({ key: "Enter", metaKey: true, isComposing: true })).toBeNull();
  });

  it("reads Option keys by code, since a Mac's Option changes the key", () => {
    expect(spawnKey({ altKey: true, code: "Digit2", key: "™" })).toEqual({ kind: "pick", index: 1 });
    expect(spawnKey({ altKey: true, code: "Digit0", key: "º" })).toEqual({ kind: "reset" });
    expect(spawnKey({ altKey: true, code: "BracketLeft", key: "“" })).toEqual({ kind: "move", step: -1 });
    expect(spawnKey({ altKey: true, code: "BracketRight", key: "‘" })).toEqual({ kind: "move", step: 1 });
    expect(spawnKey({ code: "Digit2", key: "2" })).toBeNull();
    expect(spawnKey({ altKey: true, ctrlKey: true, code: "Digit2", key: "2" })).toBeNull();
  });
});

describe("repoChips", () => {
  it("draws a radio per repo, the picked one checked and in the tab order, each with its shortcut", () => {
    const html = repoChips(REPOS, "blazetrailsdev/trailmap");
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).toContain('data-name="blazetrailsdev/trailmap" aria-checked="true" tabindex="0"');
    expect(html).toContain('data-name="blazetrailsdev/trails" aria-checked="false" tabindex="-1"');
    expect(html).toContain("trailmap <kbd>⌥2</kbd>");
  });
});

describe("modelOptions", () => {
  const config = { spawn_model: "opus", supported_models: ["opus", "sonnet", "haiku", "fable"] };
  it("offers the loop's model as the default, then every model ringo takes", () => {
    const html = modelOptions(config, "");
    expect(html.startsWith('<option value="" selected>Loop default (opus)</option>')).toBe(true);
    expect(html.match(/<option/g)).toHaveLength(5);
  });

  it("keeps a chosen model chosen", () => {
    expect(modelOptions(config, "sonnet")).toContain('<option value="sonnet" selected>sonnet</option>');
  });

  it("still offers the default before ringo has answered", () => {
    expect(modelOptions(null, "")).toBe('<option value="" selected>Loop default</option>');
  });
});

describe("derivedName", () => {
  it("is ringo's worktreeSlugN of the first non-blank line", () => {
    expect(derivedName("\n  Let's take another pass on the spawn modal\nmore")).toBe("lets-take-another-pass-on-the-spawn-moda");
    expect(derivedName("fix: a/b_c  d")).toBe("fix-a-b-c-d");
    expect(derivedName("!!!")).toBe("task");
  });
});

describe("taskHeight", () => {
  it("grows with the content up to half the viewport", () => {
    expect(taskHeight(120, 1000)).toBe(120);
    expect(taskHeight(900, 1000)).toBe(500);
  });
});
