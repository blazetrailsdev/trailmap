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
}
