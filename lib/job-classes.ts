import { registerConstant } from "@blazetrails/ruby-compat";
import { ApplicationJob } from "../app/jobs/application-job.ts";
import { StatsSyncJob } from "../app/jobs/stats-sync-job.ts";
import { TandemProbeJob } from "../app/jobs/tandem-probe-job.ts";

// Every job class, registered by name: a queued job and config/recurring.yml
// name their class as a string, and the worker resolves it through this registry.
//
// Out of app/jobs because it defines no constant of its own, which the
// autoloader requires of a file there (RFC 0213). Deleted by the trails bump
// that brings `Loader#importer` (trails#9683): the autoloader then seats each
// job, in the same module graph as the code that imports it.
registerConstant("ApplicationJob", ApplicationJob);
registerConstant("StatsSyncJob", StatsSyncJob);
registerConstant("TandemProbeJob", TandemProbeJob);

export { ApplicationJob, StatsSyncJob, TandemProbeJob };
