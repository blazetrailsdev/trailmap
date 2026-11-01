// Solid Queue's supervisor, as `solid_queue:install` writes bin/jobs:
//
//   require_relative "../config/environment"
//   require "solid_queue/cli"
//   SolidQueue::Cli.start(ARGV)
//
// The `worker` process in the Procfile. It boots the application (so the
// engine's initializers point SolidQueue at the `queue` database), then loads
// the job classes and the CLI, and then runs dispatcher, worker and scheduler from
// config/queue.yml and config/recurring.yml until it is signalled.
//
// app/jobs and the CLI are imported dynamically, after the boot, as bin/jobs
// requires solid_queue/cli after config/environment. For app/jobs the ordering is load-bearing.
// config/environment.ts awaits `Trails.initialize()` at its top level, and a
// sibling static import does NOT wait for that: the module graph evaluates it
// at the first await, before the initializers have run. A job's static block
// would then call `limitsConcurrency`, which only exists once the Solid Queue
// engine's `solid_queue.active_job.extensions` initializer has run.
import "../config/environment.ts";

await import("../app/jobs/index.ts");
const { Cli } = await import("@blazetrails/solid-queue/cli");
await new Cli().start();
