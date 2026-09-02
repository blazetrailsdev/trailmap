import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: "app",
  publicDir: "../public",
  build: {
    outDir: "../public/assets",
    manifest: true,
    rollupOptions: {
      input: {
        application: fileURLToPath(
          new URL("app/assets/stylesheets/application.css", import.meta.url),
        ),
      },
    },
  },
});
