import type { Mapper } from "@blazetrails/actionpack";

export function drawRoutes(mapper: Mapper): void {
  mapper.root("home#index");
  mapper.get("up", "health#show");
}
