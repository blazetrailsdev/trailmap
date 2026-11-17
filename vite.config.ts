import { defineConfig } from "vite";
import RubyPlugin from "vite-plugin-ruby";

// vite_rails' build: entrypoints, output directory and manifest come from
// config/vite.json, through vite-plugin-ruby, as they do in a Rails app.
// Builds only: vite_rails' dev server is a process of its own, while trails'
// development server embeds Vite, and the plugin's server settings (its port
// and base) would take that server over. Development builds on demand
// (autoBuild in config/vite.json) instead.
export default defineConfig({
  plugins: RubyPlugin().map((plugin) => ({ ...plugin, apply: "build" as const })),
  // ringo's chart files are symlinked into app/assets from vendor/ringo; keep
  // them there, or the manifest keys them by the vendor path.
  resolve: { preserveSymlinks: true },
  // Unminified, and UTF-8 kept as UTF-8: scripts/smoke-boot.sh needs the
  // assets' non-ASCII bytes to prove the server does not re-encode them.
  build: { minify: false },
  esbuild: { charset: "utf8" },
});
