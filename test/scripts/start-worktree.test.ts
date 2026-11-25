import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The dashboard's respawn button re-attaches an agent with
 * `start-worktree.sh --branch <branch> [<name>]`, the trails interface.
 * These cover the paths that exit before any worktree or install happens.
 */
const script = resolve("scripts/start-worktree.sh");

function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), "start-worktree-"));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, stdio: "ignore" });
  git(root, "init", "-q", "--bare", "origin.git");
  const repo = join(root, "repo");
  git(root, "clone", "-q", "origin.git", "repo");
  git(
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  git(repo, "push", "-q", "origin", "HEAD:main");
  git(
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "pr work",
  );
  git(repo, "push", "-q", "origin", "HEAD:refs/heads/fix/pr-branch");
  git(repo, "reset", "-q", "--hard", "HEAD~1");
  mkdirSync(join(repo, "scripts"));
  copyFileSync(script, join(repo, "scripts", "start-worktree.sh"));
  return root;
}

function run(root: string, ...args: string[]) {
  return spawnSync(
    "bash",
    [join(root, "repo", "scripts", "start-worktree.sh"), ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TASKS_CANONICAL: join(root, "no-tasks"),
        WORKTREES_ROOT: join(root, "wt"),
      },
    },
  );
}

describe("start-worktree.sh --branch", () => {
  const root = sandbox();

  it("prints both usages when --branch has no value", () => {
    const r = run(root, "--branch");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--branch <existing-branch> [<name>]");
  });

  it("refuses a branch that would read as a git flag", () => {
    const r = run(root, "--branch", "-x");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("invalid branch name");
  });

  it("refuses a branch with ..", () => {
    expect(run(root, "--branch", "a..b").status).toBe(2);
  });

  it("refuses a name containing a slash", () => {
    expect(run(root, "--branch", "fix/foo", "a/b").status).toBe(2);
  });

  it("refuses to invent a branch that exists nowhere", () => {
    const r = run(root, "--branch", "no-such-branch");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("exists neither locally nor on origin");
  });

  it("still rejects extra arguments without --branch", () => {
    expect(run(root, "a", "b").status).toBe(2);
  });

  it("checks out an origin-only branch with its commits, under a flattened name", () => {
    const r = run(root, "--branch", "fix/pr-branch");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const wt = join(root, "wt", "fix-pr-branch");
    const head = (...args: string[]) =>
      execFileSync("git", args, { cwd: wt, encoding: "utf8" }).trim();
    expect(head("rev-parse", "--abbrev-ref", "HEAD")).toBe("fix/pr-branch");
    expect(head("log", "-1", "--format=%s")).toBe("pr work");
    expect(head("rev-parse", "--abbrev-ref", "@{upstream}")).toBe(
      "origin/fix/pr-branch",
    );
  });
});
