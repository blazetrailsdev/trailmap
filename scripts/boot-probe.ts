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
import "../config/environment.js";

console.log("boot-probe: booted");
