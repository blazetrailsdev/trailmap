import { join } from "node:path";
import { setAppPath } from "@blazetrails/trailties/app-path";

const APP_PATH = join(import.meta.dirname, "../config/application.ts");
setAppPath(APP_PATH);
await import("@blazetrails/trailties/commands");
