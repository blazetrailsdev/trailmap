import { Trails } from "@blazetrails/trailties";
import { AUDIT_SEGMENT } from "./audit-files.ts";
import { LOGIN_FORMAT, RESERVED_OWNER_NAMES } from "./owner-names.ts";

// Re-exported so `test/routes.test.ts` and anything reading the route table
// can reach them from here, where they are used.
export { LOGIN_FORMAT, RESERVED_OWNER_NAMES };

/**
 * `:owner` — one path segment that is login-shaped and is not a reserved page.
 *
 * No `^` or `$`: a segment constraint is matched against the segment itself,
 * and an anchored pattern is rejected, as it is in Rails.
 *
 * The reserved-name half is belt AND braces: `Owner` also refuses to save one
 * (an exclusion validation), because a constraint only stops such an owner
 * being REACHED, not being created — and an owner nothing can route to is
 * worse than a refused one.
 */
export const OWNER_SEGMENT = new RegExp(
  `(?!(?:${RESERVED_OWNER_NAMES.join("|")})$)${LOGIN_FORMAT.source}`,
);

/** `:repo` — a repository name, as `Repository` validates it. */
export const REPO_SEGMENT = /[A-Za-z0-9][A-Za-z0-9._-]*/;

// `config/routes.rb`, as Rails writes it and as `trails new` generates it:
//
//     Rails.application.routes.draw do
//       root "home#index"
//       get "up" => "rails/health#show", as: :rails_health_check
//     end
//
// The file draws when it is loaded, and it exports nothing. The framework
// imports it at boot, after the application is registered. The suite and the
// page gates do the same two imports themselves (`config/application`, then
// this file) and read `Trails.application.routes()`, so there is one table and
// nobody draws it a second way — see test/support/controller-test-case.ts.
Trails.application!.routes().draw(function () {
  this.root("home#index");
  // The framework's health controller: 200 if the app booted, otherwise 500.
  this.get("up", { to: "rails/health#show", as: "rails_health_check" });

  // The two probes beside `/up`, which stays the only one a supervisor polls.
  // `ready` opens the database and the tasks checkout; `deep` computes a ready
  // queue. Both are loopback-only (ProbesController).
  this.get("up/ready", { to: "probes#ready" });
  this.get("up/deep", { to: "probes#deep" });

  // The fleet dashboard, ported from ringo's `/`. It is NOT trailmap's root:
  // ringo keeps serving `/` until this is verified against the live fleet, and
  // moving trailmap's own landing page out from under `/` before then would
  // change two things in one step.
  this.get("dashboard", { to: "dashboard#index" });
  this.get("fleet/socket", { to: "fleet#socket" });
  this.post("fleet/control/*path", { to: "fleet#control" });

  // Who is reviewing each open PR, relayed from ringo: the reviewer half of
  // every PR row's pane mini-table, which the event envelope does not carry.
  this.get("fleet/reviewers", { to: "fleet#reviewers" });
  // Usage, relayed questions and drain progress: ringo answers these outside
  // the stream too. `:name` is a key of `FLEET_READS`, not a ringo path.
  this.get("fleet/read/:name", { to: "fleet#read" });

  // One agent's tmux pane, live and read-only: the page, and the relay it
  // polls for ringo's capture of the screen. `:id` is the pane id without its
  // `%` (`%42` is `/panes/42`), which both actions check as digits.
  this.get("panes/:id", { to: "panes#show" });
  this.get("fleet/pane/:id/screen", { to: "fleet#screen" });

  // The deploy history and one run's log, relayed read-only from ringo, which
  // keeps both on its own disk (DeploysController). ringo's spelling of the
  // log URL, `?id=`, is kept so a link copied from either page works on both.
  this.get("deploys", { to: "deploys#index" });
  this.get("deploys/log", { to: "deploys#log" });

  // The session archive, relayed read-only from ringo (SessionsController):
  // the index, one PR's archives at ringo's own path, and ringo's JSON.
  this.get("sessions", { to: "sessions#index" });
  this.get("sessions/:owner/:repo/:pr", { to: "sessions#show", constraints: { pr: /\d+/ } });
  this.get("api/sessions", { to: "sessions#api" });

  // The list pages. Plural, and they come BEFORE the singular show routes only
  // by convention — the patterns cannot collide. The status/filter tab is a
  // query parameter rather than a path segment (`/rfcs?status=draft`) because
  // it selects a slice of one list, not a different resource, and ringo's
  // deep-link (`/tasks/done`) is the only path form it ever had.
  this.get("rfcs", { to: "rfc_pages#index" });
  this.get("backlog", { to: "story_pages#index" });
  // Search over every story and RFC: one ranked list, paged like the backlog.
  this.get("search", { to: "searches#show" });

  // The show pages. Singular paths, matching the URLs ringo already serves and
  // the ones the wiki-link renderer emits (`/story/<id>`) — a link that lives
  // in a story body has to keep working when trailmap takes these over. They
  // are distinct from the plural `stories/:id` JSON route below, which is the
  // loopback-only read verb and not a page.
  this.get("rfc/:id", { to: "rfc_pages#show" });
  this.get("story/:id", { to: "story_pages#show" });

  // The read verbs, one route per CLI verb. The named collection routes come
  // BEFORE `stories/:id` because recognition takes the first match, and
  // `/stories/ready` is a perfectly good story id as far as the pattern is
  // concerned.
  this.get("stories/ready", { to: "stories#ready" });
  this.get("stories/next-bundle", { to: "stories#nextBundle" });
  this.get("stories/touching", { to: "stories#touching" });
  this.get("stories", { to: "stories#index" });
  this.get("stories/:id", { to: "stories#show" });

  // The parity graphs, ported from ringo's `/graphs/parity`. Two routes, not
  // one with content negotiation: the page is a static document and the data
  // is parameterised, so they are not two representations of one resource.
  // `parity_graphs` is the controller PATH the autoloader keys
  // `parity-graphs-controller.ts` by, as `read_models` is below — a camelCase
  // spelling here is a 404 at dispatch. The data route comes FIRST only for
  // readability; the patterns cannot collide.
  this.get("graphs/parity/data", { to: "parity_graphs#data" });
  this.get("graphs/parity", { to: "parity_graphs#show" });

  // The audits, ported from ringo's `/audits`. A resource: `index` is the
  // list, `show` an audit's page, and the member `raw` the file on its own,
  // sandboxed. `:id` is the filename, constrained by ringo's `auditFileRe`
  // (config/audit-files.ts), so a traversal, a dotfile or any other bad name
  // matches no route and is a 404 before a controller runs. `format: false`
  // because the extension is part of the id: `a.md` is the audit `a.md`, not
  // the audit `a` as markdown.
  this.resources(
    "audits",
    { only: ["index", "show"], constraints: { id: AUDIT_SEGMENT }, format: false },
    () => {
      this.get("raw", { on: "member" });
    },
  );
  // ringo's viewer URL, kept as a redirect to `raw` under the same constraint.
  this.get("audits/view/:file", {
    to: this.redirect((params) => `/audits/${encodeURIComponent(String(params.file))}/raw`),
    constraints: { file: AUDIT_SEGMENT },
    format: false,
  });

  // The read-models ringo consumes whole, replacing the `index.json` and
  // `events.json` it used to unmarshal from disk.
  // `read_models` is the controller PATH the autoloader keys
  // `read-models-controller.ts` by (Rails' `underscore`), not a camelCase
  // identifier — recognition looks the route's controller string up in that
  // table verbatim, so a camelCase spelling here is a 404 at dispatch.
  this.get("index", { to: "read_models#index" });
  this.get("events", { to: "read_models#events" });

  // The mutation verbs. POST, one route per CLI verb, path segment spelled the
  // way the CLI spells it — `stories/status-set`, not a REST-shaped update —
  // so a caller reading the CLI's usage can find the endpoint, and so a verb
  // that is not a field write (`record-spawn`, `claim`) is not dressed up as
  // one. Ids travel in the JSON body, never in the path, because every batch
  // verb takes a list.
  this.post("stories/claim", { to: "mutations#claim" });
  this.post("stories/release", { to: "mutations#release" });
  this.post("stories/in-progress", { to: "mutations#inProgress" });
  this.post("stories/done", { to: "mutations#done" });
  this.post("stories/record-spawn", { to: "mutations#recordSpawn" });
  this.post("stories/block", { to: "mutations#block" });
  this.post("stories/close", { to: "mutations#close" });
  this.post("stories/status-set", { to: "mutations#statusSet" });
  this.post("stories/priority", { to: "mutations#priority" });

  // ──────────────────── the GitHub-shaped hierarchy ────────────────────
  //
  // `/:owner`, `/:owner/:repo` and the eight tabs under a repo, served from
  // the `hub` database's models (app/models/hub.ts). Deliberately not a shape
  // ringo has: ringo's pages keep serving, and nothing above this comment
  // changed.
  //
  // DRAWN LAST, and that is load-bearing — recognition takes the first match,
  // so every route above wins over `/:owner`. See RESERVED_OWNER_NAMES for the
  // other half of the collision.
  //
  // The nested blocks are arrows, which take `this` lexically from the
  // enclosing `function ()`. Since trails#8766
  // (`scope-and-constraints-call-their-block-unbound`, done) `scope` and
  // `constraints` also bind a nested block to the mapper, as Rails'
  // `instance_eval` keeps `self`, so a nested `function ()` would work too.
  this.constraints({ owner: OWNER_SEGMENT, repo: REPO_SEGMENT }, () => {
    // Spelled with the leading slash: trails writes a Ruby Symbol as a string
    // with its colon (trails CLAUDE.md, "A Ruby Symbol is a JS string"), so a
    // bare ":owner" is `get :owner`, the static path /owner (trails#8875).
    this.get("/:owner", { to: "owners#show", as: "owner" });

    // The eight tabs. `scope` carries the shared `:owner/:repo` prefix and the
    // `repo_` route-helper names; the controllers are flat, named
    // `repo_<tab>`, and the reason is not style:
    //
    // `scope(..., { module: "repos" })` with the controllers in
    // `app/controllers/repos/` DOES dispatch — the autoloader keys a nested
    // file by its directory, so `repos/issues` resolves (finisher.ts,
    // `collectControllers`). But `controllerPath()` and therefore `_prefixes()`
    // are derived from the CLASS NAME, which in TypeScript carries no module,
    // so the same controller looks its views up under `issues/` while routing
    // as `repos/issues`. The two spellings disagree, and the only ways to
    // reconcile them are a `localPrefixes` or `controllerPath` override — both
    // of which this codebase forbids (test/views/view-directory-names.test.ts).
    // Flat `RepoIssuesController` has one spelling for both. The divergence is
    // a trails story, not something to paper over here.
    this.scope(":owner/:repo", { as: "repo" }, () => {
      // The code tab IS the repository page, as `/owner/repo` is on GitHub.
      this.get("", { to: "repo_code#show" });
      this.resources("issues", { only: ["index", "show"], controller: "repo_issues" });
      this.resources("pulls", { only: ["index", "show"], controller: "repo_pulls" });
      this.resources("projects", { only: ["index", "show"], controller: "repo_projects" });
      this.get("actions", { to: "repo_actions#index" });
      this.get("wiki", { to: "repo_wiki#index" });
      // `pulse`, not `insights`: GitHub's Insights tab lands on /pulse.
      this.get("pulse", { to: "repo_insights#show" });
      this.get("settings", { to: "repo_settings#show" });
    });
  });
});
