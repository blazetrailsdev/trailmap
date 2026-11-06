// Add your own tasks in files placed in lib/tasks ending in .ts, for example lib/tasks/capistrano.ts, and they will automatically be available to Rake.

import { Trails } from "@blazetrails/trailties";

import "./config/application.ts";

await Trails.application.loadTasks();
