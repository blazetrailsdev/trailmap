import { registerConstant } from "@blazetrails/ruby-compat";
import { ApplicationJob } from "./application-job.ts";
import { StatsSyncJob } from "./stats-sync-job.ts";
import { TandemProbeJob } from "./tandem-probe-job.ts";

// Every job class, registered by name: a queued job and config/recurring.yml
// name their class as a string, and the worker resolves it through this registry.
registerConstant("ApplicationJob", ApplicationJob);
registerConstant("StatsSyncJob", StatsSyncJob);
registerConstant("TandemProbeJob", TandemProbeJob);

export { ApplicationJob, StatsSyncJob, TandemProbeJob };
