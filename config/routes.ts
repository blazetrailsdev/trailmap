import type { Mapper } from "@blazetrails/actionpack";

export function drawRoutes(mapper: Mapper): void {
  mapper.root("home#index");
  mapper.get("up", "health#show");

  // The show pages. Singular paths, matching the URLs ringo already serves and
  // the ones the wiki-link renderer emits (`/story/<id>`) — a link that lives
  // in a story body has to keep working when trailmap takes these over. They
  // are distinct from the plural `stories/:id` JSON route below, which is the
  // loopback-only read verb and not a page.
  mapper.get("rfc/:id", "rfc_pages#show");
  mapper.get("story/:id", "story_pages#show");

  // The read verbs, one route per CLI verb. The named collection routes come
  // BEFORE `stories/:id` because recognition takes the first match, and
  // `/stories/ready` is a perfectly good story id as far as the pattern is
  // concerned.
  mapper.get("stories/ready", "stories#ready");
  mapper.get("stories/next-bundle", "stories#nextBundle");
  mapper.get("stories/touching", "stories#touching");
  mapper.get("stories", "stories#index");
  mapper.get("stories/:id", "stories#show");

  // The read-models ringo consumes whole, replacing the `index.json` and
  // `events.json` it used to unmarshal from disk.
  // `read_models` is the controller PATH the autoloader keys
  // `read-models-controller.ts` by (Rails' `underscore`), not a camelCase
  // identifier — recognition looks the route's controller string up in that
  // table verbatim, so a camelCase spelling here is a 404 at dispatch.
  mapper.get("index", "read_models#index");
  mapper.get("events", "read_models#events");

  // The mutation verbs. POST, one route per CLI verb, path segment spelled the
  // way the CLI spells it — `stories/status-set`, not a REST-shaped update —
  // so a caller reading the CLI's usage can find the endpoint, and so a verb
  // that is not a field write (`record-spawn`, `claim`) is not dressed up as
  // one. Ids travel in the JSON body, never in the path, because every batch
  // verb takes a list.
  mapper.post("stories/claim", "mutations#claim");
  mapper.post("stories/release", "mutations#release");
  mapper.post("stories/in-progress", "mutations#inProgress");
  mapper.post("stories/done", "mutations#done");
  mapper.post("stories/record-spawn", "mutations#recordSpawn");
  mapper.post("stories/block", "mutations#block");
  mapper.post("stories/close", "mutations#close");
  mapper.post("stories/status-set", "mutations#statusSet");
  mapper.post("stories/priority", "mutations#priority");
}
