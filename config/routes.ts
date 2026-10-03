import { Trails } from "@blazetrails/trailties";

// `config/routes.rb`, as Rails writes it and as `trails new` generates it:
//
//     Rails.application.routes.draw do
//       root "home#index"
//       get "up", to: "health#show"
//     end
//
// The file draws when it is loaded, and it exports nothing. The framework
// imports it at boot, after the application is registered. The suite and the
// page gates do the same two imports themselves (`config/application`, then
// this file) and read `Trails.application.routes()`, so there is one table and
// nobody draws it a second way — see test/support/controller-test-case.ts.
Trails.application!.routes().draw(function () {
  this.root("home#index");
  this.get("up", { to: "health#show" });

  // The fleet dashboard, ported from ringo's `/`. It is NOT trailmap's root:
  // ringo keeps serving `/` until this is verified against the live fleet, and
  // moving trailmap's own landing page out from under `/` before then would
  // change two things in one step.
  this.get("dashboard", { to: "dashboard#index" });

  // The list pages. Plural, and they come BEFORE the singular show routes only
  // by convention — the patterns cannot collide. The status/filter tab is a
  // query parameter rather than a path segment (`/rfcs?status=draft`) because
  // it selects a slice of one list, not a different resource, and ringo's
  // deep-link (`/tasks/done`) is the only path form it ever had.
  this.get("rfcs", { to: "rfc_pages#index" });
  this.get("backlog", { to: "story_pages#index" });

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
});
