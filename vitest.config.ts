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
    // `Base.configurations`, which `Hub` and `Stats` resolve `connectsTo` against.
    setupFiles: ["test/support/database-configurations.ts"],
  },
});
