// Solid Queue's supervisor, as `solid_queue:install` writes bin/jobs:
//
//   require_relative "../config/environment"
//   require "solid_queue/cli"
//   SolidQueue::Cli.start(ARGV)
//
// The `worker` process in the Procfile. It boots the application (so the
// engine's initializers point SolidQueue at the `queue` database), then loads
// the CLI, and then runs dispatcher, worker and scheduler from
// config/queue.yml and config/recurring.yml until it is signalled.
//
// The CLI is imported dynamically, after the boot, as bin/jobs requires
// solid_queue/cli after config/environment. The autoloader seats the job
// classes by name, so a queued job or config/recurring.yml resolves them.
import { rbArgv } from "@blazetrails/ruby-compat";
import "../config/environment.ts";

const { Cli } = await import("@blazetrails/solid-queue/cli");
// Thor declares `start` on its class type, which Cli's type does not inherit.
// Remove the cast with trails story thor-subclass-types-carry-static-start.
await (Cli as unknown as { start(argv: string[]): Promise<unknown> }).start(
  rbArgv(),
);
