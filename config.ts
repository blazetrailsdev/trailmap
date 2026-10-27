// This file is used by Rack-based servers to start the application.
import { Trails } from "@blazetrails/trailties";

import "./config/environment.ts";

export default Trails.application;

Trails.application.loadServer();
