/**
 * BOOT THE APPLICATION, and say so — the whole probe.
 *
 * `config/environment.ts` is what a served process loads: it imports
 * `config/application.ts` and awaits `Trails.initialize()`, which runs the
 * `load_config_initializers` initializer (Rails' `engine.rb:644-648`,
 * mirrored at `@blazetrails/trailties/dist/engine.js:266`) and so imports
 * every file under `config/initializers` in sorted order.
 *
 * That is the path the deployed 500 came down, and it is the path a unit test
 * calling `connectToTasksDatabase()` by hand cannot reach: a test that imports
 * the module has already run it, and would keep passing if the initializer
 * stopped being LOADED at boot. This runs the real thing in its own process,
 * so `scripts/smoke-boot.sh` can assert both directions — boots with a
 * database, refuses without one.
 */
import { exit } from "@blazetrails/ruby-compat";
import "../config/environment.ts";

console.log("boot-probe: booted");

// END THE PROBE, explicitly.
//
// Booting now opens a PostgreSQL pool — the `hub` database, established by
// `config/initializers/hub-database.ts` — and an open pool's sockets keep
// Node's event loop alive. A process that ended by itself while every
// connection was SQLite (better-sqlite3 is synchronous and holds no libuv
// handle) now never would, and `scripts/smoke-boot.sh` waits on this
// pipeline: the whole job hangs rather than fails, which is the worst way for
// a check to go wrong.
//
// A SERVED process should hold those connections open; this one has said the
// only thing it exists to say. Ending is its job, not the framework's — the
// same lesson trails#8730 applied to `trails db`, one layer up.
//
// `exit` is ruby-compat's, as every other script here uses: this tsconfig
// carries no @types/node, so a bare `process` does not typecheck.
exit(0);
