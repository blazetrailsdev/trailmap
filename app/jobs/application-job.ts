import { Base } from "@blazetrails/activejob";
import { registerConstant } from "@blazetrails/ruby-compat";

/**
 * Every trailmap job's base class, as `trails new` would generate it (Rails'
 * app/jobs/application_job.rb). Registered by name because a job is found by
 * its class NAME twice: the recurring scheduler resolves `class:` from
 * config/recurring.yml, and the worker resolves the payload's `job_class`.
 * Rails autoloads both; trails has no autoloader, so registration is the
 * lookup (app/jobs/index.ts imports every job for the same reason).
 */
export class ApplicationJob extends Base {}

registerConstant("ApplicationJob", ApplicationJob);
