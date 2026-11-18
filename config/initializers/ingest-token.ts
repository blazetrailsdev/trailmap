import { Trails } from "@blazetrails/trailties";
import { env } from "@blazetrails/ruby-compat";

// The ingest create endpoints (`POST /rfc-refines`) fail closed without it.
if ((env.TRAILMAP_INGEST_TOKEN ?? "") === "" && !Trails.env["test?"]()) {
  Trails.logger?.warn(
    "TRAILMAP_INGEST_TOKEN is not set: every ingest create request will be refused with a 401 (see docs/deploy.md)",
  );
}
