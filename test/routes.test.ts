import { describe, it, expect } from "vitest";
import { RouteSet } from "@blazetrails/actionpack";
import { assertRecognizes } from "@blazetrails/actionpack/testing";
import { Trails } from "@blazetrails/trailties";
import { RESERVED_OWNER_NAMES } from "../config/routes.ts";

/** The application's route set, drawn by `config/routes.ts` when it loaded. */
function routeSet(): RouteSet {
  return Trails.application!.routes();
}

/**
 * Rails' `assert_recognizes`, against the application's own routes, where
 * test-help points `ActionDispatch::IntegrationTest`. The expected options are
 * the WHOLE recognized hash, so a stray `format` or segment fails the case.
 */
function recognizes(expected: Record<string, unknown>, path: string, method = "GET"): void {
  assertRecognizes.call({ routes: routeSet() }, expected, { path, method });
}

/**
 * The JSON APIs' `defaults: { format: "json" }`: `stories`, `read_models` and
 * `mutations` answer JSON without a `.json` suffix, and recognition says so.
 */
const json = { format: "json" };

/** `assert_raises(ActionController::RoutingError) { assert_recognizes … }`. */
function unrecognized(path: string, method = "GET"): () => void {
  return () => recognizes({}, path, method);
}

describe("config/routes", () => {
  it("routes the dashboard root to home#index", () => {
    recognizes({ controller: "home", action: "index" }, "/");
  });

  // The framework's controller, from `@blazetrails/trailties`.
  it("routes the health endpoint to trails/health#show", () => {
    recognizes({ controller: "trails/health", action: "show" }, "/up");
  });

  it("routes the readiness and deep probes beside it, to probes", () => {
    recognizes({ controller: "probes", action: "ready" }, "/up/ready");
    recognizes({ controller: "probes", action: "deep" }, "/up/deep");
  });

  it("routes the plural list paths to the same page controllers", () => {
    recognizes({ controller: "rfc_pages", action: "index" }, "/rfcs");
    recognizes({ controller: "story_pages", action: "index" }, "/backlog");
  });

  it("routes the fleet dashboard, which is not the root", () => {
    recognizes({ controller: "dashboard", action: "index" }, "/dashboard");

    // ringo keeps serving its own `/` until this page is verified, so
    // trailmap's root is still its landing page.
    recognizes({ controller: "home", action: "index" }, "/");
  });

  it("routes audits as a resource whose id is the whole filename", () => {
    recognizes({ controller: "audits", action: "index" }, "/audits");

    // The extension is part of the id, not a `.md` format.
    recognizes({ controller: "audits", action: "show", id: "a-tie.md" }, "/audits/a-tie.md");
    recognizes({ controller: "audits", action: "raw", id: "b-tie.html" }, "/audits/b-tie.html/raw");
  });

  it("refuses a path traversal, a dotfile and any name auditFileRe rejects", () => {
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
      expect(unrecognized(path), path).toThrow(/No route matches/);
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
    recognizes({ controller: "panes", action: "show", id: "42" }, "/panes/42");
    recognizes({ controller: "fleet", action: "screen", id: "42" }, "/fleet/pane/42/screen");
  });

  it("routes the reviewer relay the PR rows poll", () => {
    recognizes({ controller: "fleet", action: "reviewers" }, "/fleet/reviewers");
    recognizes({ controller: "fleet", action: "read", name: "codex-usage" }, "/fleet/read/codex-usage");
  });

  it("routes the singular show-page paths to their page controllers", () => {
    recognizes({ controller: "rfc_pages", action: "show", id: "0136-trailmap" }, "/rfc/0136-trailmap");
    recognizes(
      { controller: "story_pages", action: "show", id: "render-the-rfc-and-story-show-pages" },
      "/story/render-the-rfc-and-story-show-pages",
    );
  });

  it("keeps the plural stories JSON routes distinct from the show pages", () => {
    recognizes({ ...json, controller: "stories", action: "show", id: "anything" }, "/stories/anything");
    recognizes({ controller: "story_pages", action: "show", id: "anything" }, "/story/anything");
  });

  it("routes each read verb to the stories controller", () => {
    const verbs: [string, string][] = [
      ["/stories", "index"],
      ["/stories/ready", "ready"],
      ["/stories/next-bundle", "nextBundle"],
      ["/stories/touching", "touching"],
    ];

    for (const [path, action] of verbs) recognizes({ ...json, controller: "stories", action }, path);
  });

  it("routes the whole read-models to the read_models controller", () => {
    recognizes({ ...json, controller: "read_models", action: "index" }, "/index");
    recognizes({ ...json, controller: "read_models", action: "events" }, "/events");
  });

  it("routes each mutation verb to the mutations controller", () => {
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

    for (const [path, action] of verbs) recognizes({ ...json, controller: "mutations", action }, path, "POST");
  });

  // The mutation paths sit under `/stories/`, where `stories#show` also lives.
  // A GET of one must stay a `show` lookup rather than being recognized as the
  // verb — the method is the only thing separating them.
  it("keeps a GET of a mutation path on stories#show", () => {
    recognizes({ ...json, controller: "stories", action: "show", id: "claim" }, "/stories/claim");
  });

  // The named routes are drawn first for exactly this reason: `/stories/ready`
  // is a well-formed story id as far as `stories/:id` is concerned.
  it("routes an id to stories#show without swallowing the named routes", () => {
    recognizes(
      { ...json, controller: "stories", action: "show", id: "serve-the-read-verbs-as-json" },
      "/stories/serve-the-read-verbs-as-json",
    );
  });
  // ──────────────── the GitHub-shaped hierarchy ────────────────

  it("routes an owner and a repository, and names the segments", () => {
    recognizes({ controller: "owners", action: "show", owner: "blazetrailsdev" }, "/blazetrailsdev");
    recognizes(
      { controller: "repo_code", action: "show", owner: "blazetrailsdev", repo: "trails" },
      "/blazetrailsdev/trails",
    );
  });

  it("routes each repo tab to its own controller", () => {
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
      recognizes({ controller, action, owner: "blazetrailsdev", repo: "trails" }, path);
    }
  });

  it("routes a member of the three resourceful tabs", () => {
    const repo = { owner: "blazetrailsdev", repo: "trails" };

    recognizes(
      { controller: "repo_issues", action: "show", ...repo, id: "a-story" },
      "/blazetrailsdev/trails/issues/a-story",
    );
    recognizes({ controller: "repo_pulls", action: "show", ...repo, id: "7228" }, "/blazetrailsdev/trails/pulls/7228");
    recognizes(
      { controller: "repo_projects", action: "show", ...repo, id: "0136-trailmap" },
      "/blazetrailsdev/trails/projects/0136-trailmap",
    );
  });

  // THE REGRESSION TEST for the owner route. `/:owner` matches one segment, so
  // every existing top-level page is ambiguous with an organization of that
  // name, and the only two things standing between them are the drawing order
  // and RESERVED_OWNER_NAMES. A page added above the hierarchy without being
  // reserved would pass the first and fail this.
  it("leaves every reserved top-level path with its own controller", () => {
    const pages: [string, Record<string, unknown>][] = [
      ["/up", { controller: "trails/health", action: "show" }],
      ["/dashboard", { controller: "dashboard", action: "index" }],
      ["/rfcs", { controller: "rfc_pages", action: "index" }],
      ["/backlog", { controller: "story_pages", action: "index" }],
      ["/index", { ...json, controller: "read_models", action: "index" }],
      ["/events", { ...json, controller: "read_models", action: "events" }],
      ["/stories", { ...json, controller: "stories", action: "index" }],
      ["/rfc/0136-trailmap", { controller: "rfc_pages", action: "show", id: "0136-trailmap" }],
      ["/story/a-story", { controller: "story_pages", action: "show", id: "a-story" }],
      ["/panes/42", { controller: "panes", action: "show", id: "42" }],
      ["/fleet/reviewers", { controller: "fleet", action: "reviewers" }],
    ];

    for (const [path, expected] of pages) recognizes(expected, path);
  });

  it("refuses a reserved name as an owner rather than serving it as one", () => {
    // `/rfcs` is a page, so `/rfcs/0136-trailmap` is NOT a repository under an
    // owner called `rfcs` — nothing matches it at all. Without the constraint
    // it would reach `repo_code#show` and 404 there, which is the same status
    // for the wrong reason: a `/rfcs/<id>` page added later would then be
    // shadowed silently.
    expect(unrecognized("/rfcs/0136-trailmap")).toThrow(/No route matches/);

    // "Recognized as anything but owners#show" has no `assert_recognizes`
    // spelling, so this one reads the recognized controller directly.
    for (const name of RESERVED_OWNER_NAMES) {
      let controller = "(unrouted)";
      try {
        controller = String(routeSet().recognizePath(`/${name}`, { method: "GET" }).controller);
      } catch {
        // Not every reserved name is a route of its own — `assets` is served
        // by the asset middleware, `fleet` and `panes` only under a segment.
      }
      expect(controller, name).not.toBe("owners");
    }
  });

  it("refuses an owner segment that is not login-shaped", () => {
    for (const bad of ["/-leading", "/trailing-", "/two--hyphens", "/has_underscore"]) {
      expect(unrecognized(bad), bad).toThrow(/No route matches/);
    }
  });
});
