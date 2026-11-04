import { Base } from "@blazetrails/activejob";

/**
 * Every trailmap job's base class, as `trails new` would generate it (Rails'
 * app/jobs/application_job.rb). A job is found by its class NAME twice: the
 * recurring scheduler resolves `class:` from config/recurring.yml, and the
 * worker resolves the payload's `job_class`. Rails autoloads both, and so does
 * the trails autoloader.
 */
export class ApplicationJob extends Base {}
