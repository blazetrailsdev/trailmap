import type { Mapper } from "@blazetrails/actionpack";
import { Trails } from "@blazetrails/trailties";

export function drawRoutes(mapper: Mapper): void {
  mapper.root("home#index");
  mapper.get("up", { to: "health#show" });

  // The fleet dashboard, ported from ringo's `/`. It is NOT trailmap's root:
  // ringo keeps serving `/` until this is verified against the live fleet, and
  // moving trailmap's own landing page out from under `/` before then would
  // change two things in one step.
  mapper.get("dashboard", { to: "dashboard#index" });

  // The list pages. Plural, and they come BEFORE the singular show routes only
  // by convention — the patterns cannot collide. The status/filter tab is a
  // query parameter rather than a path segment (`/rfcs?status=draft`) because
  // it selects a slice of one list, not a different resource, and ringo's
  // deep-link (`/tasks/done`) is the only path form it ever had.
  mapper.get("rfcs", { to: "rfc_pages#index" });
  mapper.get("backlog", { to: "story_pages#index" });

  // The show pages. Singular paths, matching the URLs ringo already serves and
  // the ones the wiki-link renderer emits (`/story/<id>`) — a link that lives
  // in a story body has to keep working when trailmap takes these over. They
  // are distinct from the plural `stories/:id` JSON route below, which is the
  // loopback-only read verb and not a page.
  mapper.get("rfc/:id", { to: "rfc_pages#show" });
  mapper.get("story/:id", { to: "story_pages#show" });

  // The read verbs, one route per CLI verb. The named collection routes come
  // BEFORE `stories/:id` because recognition takes the first match, and
  // `/stories/ready` is a perfectly good story id as far as the pattern is
  // concerned.
  mapper.get("stories/ready", { to: "stories#ready" });
  mapper.get("stories/next-bundle", { to: "stories#nextBundle" });
  mapper.get("stories/touching", { to: "stories#touching" });
  mapper.get("stories", { to: "stories#index" });
  mapper.get("stories/:id", { to: "stories#show" });

  // The read-models ringo consumes whole, replacing the `index.json` and
  // `events.json` it used to unmarshal from disk.
  // `read_models` is the controller PATH the autoloader keys
  // `read-models-controller.ts` by (Rails' `underscore`), not a camelCase
  // identifier — recognition looks the route's controller string up in that
  // table verbatim, so a camelCase spelling here is a 404 at dispatch.
  mapper.get("index", { to: "read_models#index" });
  mapper.get("events", { to: "read_models#events" });

  // The mutation verbs. POST, one route per CLI verb, path segment spelled the
  // way the CLI spells it — `stories/status-set`, not a REST-shaped update —
  // so a caller reading the CLI's usage can find the endpoint, and so a verb
  // that is not a field write (`record-spawn`, `claim`) is not dressed up as
  // one. Ids travel in the JSON body, never in the path, because every batch
  // verb takes a list.
  mapper.post("stories/claim", { to: "mutations#claim" });
  mapper.post("stories/release", { to: "mutations#release" });
  mapper.post("stories/in-progress", { to: "mutations#inProgress" });
  mapper.post("stories/done", { to: "mutations#done" });
  mapper.post("stories/record-spawn", { to: "mutations#recordSpawn" });
  mapper.post("stories/block", { to: "mutations#block" });
  mapper.post("stories/close", { to: "mutations#close" });
  mapper.post("stories/status-set", { to: "mutations#statusSet" });
  mapper.post("stories/priority", { to: "mutations#priority" });
}

// The application draws its routes when this file is loaded, as
// `config/routes.rb` does in Rails and as `trails new` writes it: the
// framework imports the file at boot and expects the drawing to have happened.
// It used to look for an exported `drawRoutes` and call it; a file that only
// exports is now a server that boots and answers every path with "No route
// matches".
//
// `drawRoutes` stays exported because the suite and the page gates draw this
// same table into a route set of their own, with no application booted — which
// is also why the application is optional here.
Trails.application?.routes().draw(function (this: Mapper) {
  drawRoutes(this);
});
