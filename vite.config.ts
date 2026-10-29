import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const entry = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// `vite build` is the production precompile, as `trails new` generates it: it
// writes digest-stamped files and `.vite/manifest.json`, which trails'
// `computeAssetPath` reads, so `stylesheetLinkTag` and `javascriptPath` link
// the stamped names. A script's imports are rewritten to the stamped chunks,
// so a changed fleet-format.js renames everything that imports it.
export default defineConfig({
  root: "app",
  publicDir: "../public",
  build: {
    outDir: "../public/assets",
    assetsDir: ".",
    emptyOutDir: true,
    copyPublicDir: false,
    manifest: true,
    // Unminified, and UTF-8 kept as UTF-8: scripts/smoke-boot.sh needs the
    // assets' non-ASCII bytes to prove the server does not re-encode them.
    minify: false,
    rollupOptions: {
      input: {
        application: entry("app/assets/stylesheets/application.css"),
        dashboard: entry("app/assets/javascripts/dashboard.js"),
        pane: entry("app/assets/javascripts/pane.js"),
        deploys: entry("app/assets/javascripts/deploys.js"),
        "rfc-actions": entry("app/assets/javascripts/rfc-actions.js"),
        // ringo's parity chart, from the pinned snapshot (scripts/vendor-ringo.sh).
        "ringo-parity-css": entry("vendor/ringo/parity.css"),
        "ringo-parity": entry("vendor/ringo/parity-draw.js"),
      },
      // The pages load these as their own <script>s, so keep each entry's
      // exports; there is no single application bundle to fold them into.
      preserveEntrySignatures: "strict",
    },
  },
  esbuild: { charset: "utf8" },
});
