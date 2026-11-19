import { getFs } from "@blazetrails/ruby-compat";
import { buildViews } from "@blazetrails/trails-tsc";

/**
 * The two view trees the suite renders, and where each one's compiled output
 * lands: the same two builds `pnpm views` runs.
 */
const TREES = [
  { viewsDir: "app/views", outDir: ".trails/views", inPlace: false },
  { viewsDir: "test/fixtures/views", outDir: "test/fixtures/views", inPlace: true },
] as const;

async function templates(dir: string): Promise<string[]> {
  const fs = getFs();
  const found: string[] = [];
  for (const name of await fs.readdir!(dir)) {
    const path = `${dir}/${name}`;
    const stat = await fs.stat!(path);
    if (stat.isDirectory()) found.push(...(await templates(path)));
    else if (name.endsWith(".tse")) found.push(path);
  }
  return found;
}

/** Whether any template has no compiled output, or one older than itself. */
export async function isStale(viewsDir: string, outDir: string): Promise<boolean> {
  const fs = getFs();
  for (const source of await templates(viewsDir)) {
    const output = `${outDir}${source.slice(viewsDir.length)}.js`;
    let built: Date;
    try {
      built = (await fs.stat!(output)).mtime;
    } catch {
      return true;
    }
    if (built < (await fs.stat!(source)).mtime) return true;
  }
  return false;
}

/**
 * Compile the views when they are missing or older than their templates, so
 * `pnpm test` and a single `pnpm vitest run <file>` work in a fresh worktree
 * without a `pnpm views` step nobody wrote down.
 */
export async function buildStaleViews(): Promise<void> {
  for (const tree of TREES) {
    if (!(await isStale(tree.viewsDir, tree.outDir))) continue;
    await buildViews(tree.inPlace ? { viewsDir: tree.viewsDir, inPlace: true } : { viewsDir: tree.viewsDir });
  }
}
