import { Trails } from "@blazetrails/trailties";
import "../../config/application.js";

/** Set one of trailmap's own settings — `config.x.<group>.<key>` — for a test. */
export function setX(group: "fleet" | "tasks", key: string, value: string | undefined): void {
  Trails.application!.config.x[group][key] = value;
}
