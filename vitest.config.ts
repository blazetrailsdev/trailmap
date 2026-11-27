import { defineConfig } from "vitest/config";

// Vitest inherits `vite.config.ts`'s `root: "app"` otherwise, which puts the
// suite in `test/` out of reach.
export default defineConfig({
  test: {
    root: ".",
    // `.js` as well as `.ts`: the dashboard's formatting module is plain
    // browser JavaScript (it is served to the page, not compiled), so its
    // test is plain JavaScript too.
    include: ["test/**/*.test.ts", "test/**/*.test.js"],
    // A file's first page render imports every compiled view and boots the
    // app's initializers; on a cold module cache on the dev box that took
    // over 5s (the default) while CI's warmer runner stays under it, so the
    // first test of rendered-class-collisions and one-status-vocabulary
    // failed locally only.
    testTimeout: 20_000,
    globalSetup: ["test/global-setup.ts"],
    setupFiles: ["test/test-helper.ts"],
  },
});
