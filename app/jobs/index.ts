import { registerConstant } from "@blazetrails/ruby-compat";
import { ApplicationJob } from "./application-job.ts";
import { StatsSyncJob } from "./stats-sync-job.ts";

// Every job class, registered by name: a queued job and config/recurring.yml
// name their class as a string, and the worker resolves it through this registry.
registerConstant("ApplicationJob", ApplicationJob);
registerConstant("StatsSyncJob", StatsSyncJob);

export { ApplicationJob, StatsSyncJob };
