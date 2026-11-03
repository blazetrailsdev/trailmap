import { describe, expect, it } from "vitest";
import { getFs, getPath } from "@blazetrails/ruby-compat";
import { constantize } from "@blazetrails/activesupport";

/**
 * trails' Zeitwerk (RFC 0213) requires every file under an autoload path to
 * define the constant its name spells, and raises at boot otherwise. These
 * tests hold that rule over app/ before a boot has to find it, and hold each
 * plain-object module to the named exports it bundles.
 */

const ROOT = new URL("../..", import.meta.url).pathname;
// Not autoload paths: templates, front-end assets.
const NOT_AUTOLOADED = new Set(["views", "assets", "javascript"]);
// Rails makes each `concerns` directory a root of its own.
const CONCERNS = ["app/models/concerns", "app/controllers/concerns"];

const camelize = (name: string) =>
  name.replace(/(^|-)([a-z0-9])/g, (_m, _sep: string, c: string) => c.toUpperCase());

async function autoloadedFiles(): Promise<string[]> {
  const fs = getFs();
  const path = getPath();
  const roots = (await fs.readdir!(`${ROOT}app`))
    .map(String)
    .filter((dir) => !NOT_AUTOLOADED.has(dir))
    .map((dir) => `app/${dir}`)
    .concat(CONCERNS);
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const name of (await fs.readdir!(`${ROOT}${dir}`)).map(String)) {
      const rel = path.join(dir, name);
      if ((await fs.stat!(`${ROOT}${rel}`)).isDirectory()) {
        if (!roots.includes(rel)) await walk(rel);
      } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
        out.push(rel);
      }
    }
  }
  for (const root of roots) {
    if ((await fs.stat!(`${ROOT}${root}`)).isDirectory()) await walk(root);
  }
  return out.sort();
}

async function load(file: string): Promise<Record<string, unknown>> {
  return (await import(`${ROOT}${file}`)) as Record<string, unknown>;
}

// The plain-object modules that bundle a file's named exports, as a Ruby
// module of `module_function`s does. Not every plain-object constant is one:
// `LoopbackOnly` is a concern whose members are instance methods for `include`.
const BUNDLES = [
  "app/controllers/concerns/api-params.ts",
  "app/controllers/concerns/viewer.ts",
  "app/models/concerns/backlog.ts",
  "app/models/concerns/dep-graph.ts",
  "app/models/concerns/document.ts",
  "app/models/concerns/effective-status.ts",
  "app/models/concerns/elapsed.ts",
  "app/models/concerns/pager.ts",
  "app/models/concerns/ranking.ts",
  "app/models/concerns/repo-scope.ts",
  "app/models/concerns/rfc-marks.ts",
  "app/models/concerns/rfc-progress.ts",
  "app/models/concerns/search.ts",
  "app/models/concerns/semantic-validation.ts",
  "app/models/concerns/story-actions.ts",
  "app/models/deploy-log.ts",
  "app/models/parity-metric.ts",
  "app/models/parity-refresh.ts",
  "app/models/rfc-close.ts",
  "app/models/rfc-status.ts",
  "app/serializers/parity-json.ts",
  "app/serializers/rfc-json.ts",
  "app/serializers/story-json.ts",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

describe("autoloaded files", () => {
  it("each define the constant their name spells", async () => {
    const files = await autoloadedFiles();
    expect(files).toContain("app/models/story.ts");
    expect(files).toContain("app/models/concerns/repo-scope.ts");
    const missing: string[] = [];
    for (const file of files) {
      const name = camelize(getPath().basename(file).replace(/\.ts$/, ""));
      if (!(name in (await load(file)))) missing.push(`${file} -> ${name}`);
    }
    expect(missing).toEqual([]);
  });

  it("bundle every named export in their module, and nothing else", async () => {
    for (const file of BUNDLES) {
      const exports = await load(file);
      const name = camelize(getPath().basename(file).replace(/\.ts$/, ""));
      const mod = exports[name];
      expect(isPlainObject(mod), file).toBe(true);
      if (!isPlainObject(mod)) continue;
      const named = Object.keys(exports).filter((key) => key !== name).sort();
      expect(Object.keys(mod).sort(), file).toEqual(named);
      for (const key of named) expect(mod[key], `${file} ${name}.${key}`).toBe(exports[key]);
    }
    expect(BUNDLES).toHaveLength(23);
  });
});

describe("lib/job-classes.ts", () => {
  it("registers every job under its class name", async () => {
    const jobs = await import("../../lib/job-classes.ts");
    for (const name of ["ApplicationJob", "StatsSyncJob", "TandemProbeJob"] as const) {
      expect(constantize(name)).toBe(jobs[name]);
    }
  });
});
