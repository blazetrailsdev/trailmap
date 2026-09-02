// This file is used by Rack-based servers to start the application.
import { Trails } from "@blazetrails/trailties";

import "./config/environment.js";

export default Trails.application;

Trails.application.loadServer();
