// @ts-check

import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// Every promise has an owner, as in trails: an unawaited `redirectTo` lets the
// implicit render run first (trailmap#170).
export default defineConfig({
  files: ["app/**/*.ts", "lib/**/*.ts", "config/**/*.ts"],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
  },
  plugins: { "@typescript-eslint": tseslint.plugin },
  rules: {
    "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: false }],
    "@typescript-eslint/no-misused-promises": "error",
  },
});
