import type { Mapper } from "@blazetrails/actionpack";

export function drawRoutes(mapper: Mapper): void {
  mapper.root("home#index");
  mapper.get("up", "health#show");

  // The read verbs, one route per CLI verb. The named collection routes come
  // BEFORE `stories/:id` because recognition takes the first match, and
  // `/stories/ready` is a perfectly good story id as far as the pattern is
  // concerned.
  mapper.get("stories/ready", "stories#ready");
  mapper.get("stories/next-bundle", "stories#nextBundle");
  mapper.get("stories/touching", "stories#touching");
  mapper.get("stories", "stories#index");
  mapper.get("stories/:id", "stories#show");

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
