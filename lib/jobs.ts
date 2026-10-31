// Solid Queue's supervisor, as `solid_queue:install` writes bin/jobs:
//
//   require_relative "../config/environment"
//   require "solid_queue/cli"
//   SolidQueue::Cli.start(ARGV)
//
// The `worker` process in the Procfile. It boots the application (so the
// engine's initializers point SolidQueue at the `queue` database, and the
// job classes are loaded) and then runs dispatcher, worker and scheduler from
// config/queue.yml and config/recurring.yml until it is signalled.
import "../config/environment.ts";
import "../app/jobs/index.ts";
import { Cli } from "@blazetrails/solid-queue/cli";

await new Cli().start();
