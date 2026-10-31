import { Base } from "@blazetrails/activejob";

/**
 * Every trailmap job's base class, as `trails new` would generate it (Rails'
 * app/jobs/application_job.rb). app/jobs/index.ts registers every job by name: one is found by
 * its class NAME twice: the recurring scheduler resolves `class:` from
 * config/recurring.yml, and the worker resolves the payload's `job_class`.
 * Rails autoloads both; trails has no autoloader, so registration is the
 * lookup.
 */
export class ApplicationJob extends Base {}
