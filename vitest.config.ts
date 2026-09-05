import { defineConfig } from "vitest/config";

// Vitest inherits `vite.config.ts`'s `root: "app"` otherwise, which puts the
// suite in `test/` out of reach.
export default defineConfig({
  test: {
    root: ".",
    include: ["test/**/*.test.ts"],
  },
});
