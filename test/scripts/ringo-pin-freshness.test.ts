import { describe, expect, it } from "vitest";
import { getChildProcessAsync, getFs, getPath } from "@blazetrails/ruby-compat";
import { ringoPinFreshness } from "../../scripts/ringo-pin-freshness.js";

/**
 * The failure this covers is the one `SHA256` cannot see: the snapshot is
 * untouched and ringo has moved on. So the fixtures are a real git repository
 * with a real HEAD — a stubbed `git` would only prove the report's wording.
 */
async function repositoryAt(dir: string, commits: number): Promise<string> {
  const [fs, path, child] = await Promise.all([
    getFs(),
    getPath(),
    getChildProcessAsync(),
  ]);
  await fs.mkdir!(dir, { recursive: true });
  const git = (...args: string[]) => child.spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  let head = "";
  for (let i = 0; i < commits; i++) {
    await fs.writeFile!(path.join(dir, "webhook.go"), `// revision ${i}\n`);
    git("add", ".");
    git("commit", "-qm", `revision ${i}`);
    head = git("rev-parse", "HEAD").stdout.trim();
  }
  return head;
}

/** A trailmap root whose only content is `vendor/ringo/PIN`. */
async function rootPinnedAt(dir: string, commit: string): Promise<string> {
  const [fs, path] = await Promise.all([getFs(), getPath()]);
  await fs.mkdir!(path.join(dir, "vendor", "ringo"), { recursive: true });
  await fs.writeFile!(path.join(dir, "vendor", "ringo", "PIN"), `${commit}\n`);
  return dir;
}

/** A directory of this run's own, so a rerun is not a different fixture. */
async function scratch(name: string): Promise<string> {
  const [fs, path] = await Promise.all([getFs(), getPath()]);
  await fs.mkdir!("tmp", { recursive: true });
  return await fs.mkdtemp!(path.join("tmp", `${name}-`));
}

describe("ringoPinFreshness", () => {
  it("says the pin is current when it is btwhooks' HEAD", async () => {
    const path = getPath();
    const src = await scratch("ringo-fresh-src");
    const head = await repositoryAt(src, 1);
    const root = await rootPinnedAt(await scratch("ringo-fresh-root"), head);

    const found = await ringoPinFreshness(src, root);
    expect(found.head).toBe(head);
    expect(found.report.join("\n")).toContain("ringo pin is current");
  });

  it("names both commits and how far behind when btwhooks has moved on", async () => {
    const path = getPath();
    const src = await scratch("ringo-stale-src");
    await repositoryAt(src, 1);
    const child = await getChildProcessAsync();
    const pinned = child
      .spawnSync("git", ["-C", src, "rev-parse", "HEAD"], { encoding: "utf8" })
      .stdout.trim();
    const head = await repositoryAt(src, 3);
    const root = await rootPinnedAt(await scratch("ringo-stale-root"), pinned);

    const report = (await ringoPinFreshness(src, root)).report.join("\n");
    expect(report).toContain("STALE RINGO PIN");
    expect(report).toContain(pinned);
    expect(report).toContain(head);
  });

  it("says nothing to compare when the box has no btwhooks checkout", async () => {
    const path = getPath();
    const root = await rootPinnedAt(await scratch("ringo-nosrc-root"), "0".repeat(40));

    const found = await ringoPinFreshness(path.join("tmp", "ringo-no-such-checkout"), root);
    expect(found.head).toBeNull();
    expect(found.report.join("\n")).toContain("nothing to compare");
  });
});
