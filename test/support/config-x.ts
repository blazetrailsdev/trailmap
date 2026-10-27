import { Trails } from "@blazetrails/trailties";
import "../../config/application.ts";

/** Set `config.x.<group>.<key>`, one of trailmap's own settings, for a test. */
export function setX(group: "fleet" | "tasks", key: string, value: string | undefined): void {
  Trails.application!.config.x[group][key] = value;
}
