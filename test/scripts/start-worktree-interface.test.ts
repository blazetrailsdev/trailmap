import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * ringo calls trailmap's and trails' start-worktree.sh with one interface and
 * then cd's into "$WORKTREES_ROOT/<name>". This runs one argument table
 * against both copies and compares the exit code and the derived target.
 *
 * Each valid invocation finds its target already present, so both scripts stop
 * at "already exists: <target>" before fetching or checking anything out:
 * the probe reads the derived path without side effects.
 *
 * CI checks out trails and sets TRAILS_START_WORKTREE; locally the canonical
 * checkout is used when present.
 */
const trailsScript =
  process.env.TRAILS_START_WORKTREE ??
  join(homedir(), "github/blazetrailsdev/trails/scripts/start-worktree.sh");
const required = !!process.env.TRAILS_START_WORKTREE;
const present = existsSync(trailsScript);

type Row = { args: string[]; name?: string };
const table: Row[] = [
  { args: ["foo"], name: "foo" },
  { args: ["--branch", "feat-x"], name: "feat-x" },
  { args: ["--branch", "fix/pr-branch"], name: "fix-pr-branch" },
  { args: ["--branch", "fix/pr-branch", "chosen"], name: "chosen" },
  { args: [] },
  { args: ["a", "b"] },
  { args: ["--branch"] },
  { args: ["--branch", "-x"] },
  { args: ["--branch", "a..b"] },
  { args: ["--branch", "fix/foo", "a/b"] },
  { args: ["a/b"] },
  { args: [""] },
];

function sandbox(copyOf: string): string {
  const root = mkdtempSync(join(tmpdir(), "start-worktree-iface-"));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-q", repo], { stdio: "ignore" });
  mkdirSync(join(repo, "scripts"));
  copyFileSync(copyOf, join(repo, "scripts", "start-worktree.sh"));
  for (const row of table) {
    if (row.name) mkdirSync(join(root, "wt", row.name), { recursive: true });
  }
  return root;
}

function probe(root: string, args: string[]) {
  const r = spawnSync(
    "bash",
    [join(root, "repo", "scripts", "start-worktree.sh"), ...args],
    {
      encoding: "utf8",
      env: { ...process.env, WORKTREES_ROOT: join(root, "wt") },
    },
  );
  const target = /already exists: (\S+)/.exec(r.stderr)?.[1];
  return {
    status: r.status,
    target: target?.slice(join(root, "wt").length + 1),
  };
}

describe.skipIf(!present && !required)(
  "start-worktree.sh matches trails' interface",
  () => {
    const mine = sandbox(resolve("scripts/start-worktree.sh"));
    const theirs = present ? sandbox(trailsScript) : mine;
    afterAll(() => {
      rmSync(mine, { recursive: true, force: true });
      rmSync(theirs, { recursive: true, force: true });
    });

    it("finds trails' script", () => {
      expect(present, trailsScript).toBe(true);
    });

    for (const row of table) {
      it(`agrees on ${JSON.stringify(row.args)}`, () => {
        const expected = probe(theirs, row.args);
        expect(probe(mine, row.args)).toEqual(expected);
        if (row.name) expect(expected).toEqual({ status: 1, target: row.name });
        else expect(expected.status).toBe(2);
      });
    }
  },
);
