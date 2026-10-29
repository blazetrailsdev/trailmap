import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { Dir, getFs } from "@blazetrails/ruby-compat";
import { computeAssetPath, javascriptPath, stylesheetPath } from "@blazetrails/actionview";

/**
 * Every asset a page links must be served in development, where there is no
 * manifest. trails then links `/assets` + the helper's default path
 * (trailties' `assets/vite-manifest.js`, `computeAssetPath`), and only the
 * mounted Vite dev server answers it — rooted at `app/`, as vite.config.ts
 * says. A file outside `app/` has no such URL: `/graphs/parity` stayed on
 * "Loading…" because ringo's chart lived only in vendor/ringo/, so it is
 * linked into app/assets/ the way rails/ links it.
 *
 * The production half: each one is a `vite build` input, or the manifest has
 * no stamped name for it and the page links a file nobody wrote.
 */
/** A view as development has it: no manifest, so `/assets` + the default path. */
const development = {
  computeAssetPath: (source: string, options: object) => `/assets${computeAssetPath(source, options)}`,
};

async function linkedAssets(): Promise<string[]> {
  const urls = new Set<string>();
  for (const file of Dir.glob("app/views/**/*.tse")) {
    const source = await getFs().readFile(file, "utf8");
    for (const [, name] of source.matchAll(/javascriptPath\("([^"]+)"\)/g)) urls.add(javascriptPath.call(development, name));
    for (const [, name] of source.matchAll(/stylesheetLinkTag\("([^"]+)"\)/g)) urls.add(stylesheetPath.call(development, name));
  }
  return [...urls].sort();
}

describe("assets linked by a page", () => {
  let vite: ViteDevServer;

  beforeAll(async () => {
    vite = await createServer({ configFile: "vite.config.ts", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
  });

  afterAll(async () => {
    await vite?.close();
  });

  it("are served by the development server", async () => {
    const urls = await linkedAssets();
    expect(urls).toContain("/assets/javascripts/parity-draw.js");
    const missing: string[] = [];
    for (const url of urls) {
      const served = await vite.transformRequest(url).catch(() => null);
      if (served === null) missing.push(url);
    }
    expect(missing).toEqual([]);
  });

  it("are inputs of the production build", async () => {
    const inputs = Object.values(vite.config.build.rollupOptions.input as Record<string, string>).map((path) =>
      path.slice(path.lastIndexOf("/") + 1),
    );
    const urls = await linkedAssets();
    expect(urls.filter((url) => !inputs.includes(url.slice(url.lastIndexOf("/") + 1)))).toEqual([]);
  });
});
