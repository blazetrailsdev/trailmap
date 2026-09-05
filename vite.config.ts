import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: "app",
  server: {
    // `trails server` mounts Vite in front of Rack even in the deployed
    // container, and Vite answers 403 to any Host it was not told about —
    // which is how the first dokku deploy failed its health check.
    allowedHosts: ["trailmap.deanoftech.com", "localhost", "127.0.0.1"],
  },
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
