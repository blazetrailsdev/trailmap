import { describe, expect, it } from "vitest";
import {
  PALETTE_GROUP_MAX,
  highlight,
  matchScore,
  paletteActions,
  paletteFlat,
  paletteGroups,
  paletteHtml,
  paletteMove,
  palettePrs,
  paletteSessions,
  paletteStories,
  repoName,
  scopeChips,
} from "../../app/assets/javascripts/fleet-palette.js";
import { sessionKey } from "../../app/assets/javascripts/fleet-sessions.js";

/** The ⌘K palette's matching, ranking and grouping (RFC 0232 "Search"). */
const ctx = { reviewers: null, stories: {} };
const PR = { owner: "blazetrailsdev", repo: "trails", pr: 9958, title: "feat(actionmailer): preview interceptors", branch: "actionmailer-preview-interceptors", pane: "%214" };
const OTHER = { owner: "blazetrailsdev", repo: "trailmap", pr: 140, title: "feat(fleet): session rows", branch: "fleet-session-card" };
const SPAWN = { story_id: "interceptor-docs", branch: "interceptor-docs-1a2b", pane: "%5" };

describe("matchScore", () => {
  it("ranks a prefix over a word start over a substring, and misses as -1", () => {
    expect(matchScore("interceptors", "inter")).toBe(0);
    expect(matchScore("preview-interceptors", "inter")).toBe(1);
    expect(matchScore("winterceptor", "inter")).toBe(2);
    expect(matchScore("preview", "inter")).toBe(-1);
    expect(matchScore("PREVIEW", "prev")).toBe(0);
  });

  it("matches everything for an empty query", () => {
    expect(matchScore("anything", "  ")).toBe(2);
  });
});

describe("highlight", () => {
  it("marks every match and escapes the rest", () => {
    expect(highlight("<b>Inter</b> inter", "inter")).toBe("&lt;b&gt;<mark>Inter</mark>&lt;/b&gt; <mark>inter</mark>");
    expect(highlight("a<b", "")).toBe("a&lt;b");
  });

  it("never lets the query itself into the markup", () => {
    expect(highlight("x<img>y", "<img>")).toBe("x<mark>&lt;img&gt;</mark>y");
  });
});

describe("paletteSessions / palettePrs", () => {
  it("matches sessions on their story, branch, title and PR, best first", () => {
    const found = paletteSessions([OTHER, SPAWN, PR], ctx, "interceptor");

    expect(found.map((r) => r.title)).toEqual(["interceptor-docs", "feat(actionmailer): preview interceptors"]);
    expect(found[0]).toMatchObject({ kind: "session", key: sessionKey(SPAWN), pane: "%5" });
    expect(found[1].sub).toBe("blazetrailsdev/trails · Getting CI green · #9958");
  });

  it("leaves merged sessions and grooming agents out of Sessions, but keeps merged PRs", () => {
    const merged = { ...PR, merged: true };

    expect(paletteSessions([merged, { kind: "rfc-refine", story_id: "interceptor" }], ctx, "inter")).toEqual([]);
    expect(palettePrs([merged], ctx, "9958")[0]).toMatchObject({ kind: "pr", sub: "trails#9958 · merged", href: "https://github.com/blazetrailsdev/trails/pull/9958" });
  });

  it("finds a PR by its number", () => {
    expect(palettePrs([PR, OTHER], ctx, "#140").map((r) => r.title)).toEqual(["feat(fleet): session rows"]);
  });
});

describe("repoName", () => {
  it("names a PR's repo and a spawn's the same way", () => {
    expect(repoName(PR)).toBe("blazetrailsdev/trails");
    expect(repoName({ repo: "blazetrailsdev/trails" })).toBe("blazetrailsdev/trails");
  });
});

describe("paletteStories", () => {
  it("turns the server's answer into results linking each story", () => {
    expect(paletteStories([{ id: "a-story", title: "A story", status: "ready", rfc: "0188" }])).toEqual([
      { kind: "story", href: "/story/a-story", title: "a-story", sub: "A story · RFC 0188 · ready", repo: "" },
    ]);
  });
});

describe("paletteActions", () => {
  it("offers to message the top session, spawn for the text and broadcast it", () => {
    const top = paletteSessions([PR], ctx, "inter")[0];
    const actions = paletteActions("rebase", top, { all: 3, "ci-red": 1 });

    expect(actions.map((a) => a.action)).toEqual(["message", "spawn", "broadcast", "broadcast"]);
    expect(actions[0]).toMatchObject({ pane: "%214", title: "Message feat(actionmailer): preview interceptors" });
    expect(actions[1].title).toBe("Spawn a session for “rebase”");
    expect(actions.map((a) => a.target).filter(Boolean)).toEqual(["all", "ci-red"]);
  });

  it("drops the CI-red broadcast with nobody red, and message with no session to send to", () => {
    expect(paletteActions("", null, { all: 3 }).map((a) => a.action)).toEqual(["spawn", "broadcast"]);
  });
});

describe("paletteGroups", () => {
  const results = [
    ...paletteSessions([PR, OTHER], ctx, "feat"),
    ...paletteStories([{ id: "s", title: "feat", status: "ready", rfc: "r" }]),
    ...palettePrs([PR, OTHER], ctx, "feat"),
    ...paletteActions("feat", null, {}),
  ];

  it("groups by kind in a fixed order", () => {
    expect(paletteGroups(results, { kind: "all", repo: "" }).map((g) => g.kind)).toEqual(["session", "story", "pr", "action"]);
  });

  it("keeps one kind under its chip, and actions always", () => {
    expect(paletteGroups(results, { kind: "pr", repo: "" }).map((g) => g.kind)).toEqual(["pr", "action"]);
  });

  it("keeps one repo under its chip, dropping stories, which carry none", () => {
    const groups = paletteGroups(results, { kind: "all", repo: "blazetrailsdev/trailmap" });

    expect(groups.map((g) => g.kind)).toEqual(["session", "pr", "action"]);
    expect(paletteFlat(groups).filter((r) => r.kind !== "action").every((r) => r.repo === "blazetrailsdev/trailmap")).toBe(true);
  });

  it("caps each group", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...PR, pr: i + 1 }));

    expect(paletteGroups(palettePrs(many, ctx, ""), { kind: "all", repo: "" })[0].items).toHaveLength(PALETTE_GROUP_MAX);
  });
});

describe("paletteMove", () => {
  it("moves with the arrows, wrapping, and clamps a stale selection", () => {
    expect(paletteMove(0, 3, "ArrowDown")).toBe(1);
    expect(paletteMove(2, 3, "ArrowDown")).toBe(0);
    expect(paletteMove(0, 3, "ArrowUp")).toBe(2);
    expect(paletteMove(5, 3, "")).toBe(2);
    expect(paletteMove(1, 0, "ArrowDown")).toBe(0);
  });
});

describe("paletteHtml", () => {
  it("selects the top result, as an option the input points at, with matches marked", () => {
    const groups = paletteGroups(palettePrs([PR, OTHER], ctx, "feat"), { kind: "all", repo: "" });
    const html = paletteHtml(groups, 0, "feat");

    expect(html).toContain('<div class="palette-group" role="presentation">Pull requests</div>');
    expect(html).toContain('id="palette-opt-0" aria-selected="true"');
    expect(html).toContain('id="palette-opt-1" aria-selected="false"');
    expect(html).toContain("<mark>feat</mark>(actionmailer)");
  });

  it("says so when nothing matches", () => {
    expect(paletteHtml([], 0, "x")).toContain("No matches.");
  });
});

describe("scopeChips", () => {
  it("counts each kind and offers each repo, pressing the current scope", () => {
    const results = palettePrs([PR, OTHER], ctx, "");
    const html = scopeChips(results, { kind: "pr", repo: "" }, ["blazetrailsdev/trails"]);

    expect(html).toContain('data-kind="all" aria-pressed="false">All</button>');
    expect(html).toContain('data-kind="pr" aria-pressed="true">Pull requests 2</button>');
    expect(html).toContain('data-repo="blazetrailsdev/trails" aria-pressed="false">trails</button>');
  });
});
