import { Trails } from "@blazetrails/trailties";

// Load the trails application.
import "./application.ts";

Trails.autoloaders.each((loader) => {
  loader.importer = (url) => import(url);
});

// Initialize the trails application.
export default await Trails.initialize();
