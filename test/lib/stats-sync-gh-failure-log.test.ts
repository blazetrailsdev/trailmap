import { env, getFs, getOs, getPath } from "@blazetrails/ruby-compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GhCommandError, logGhFailure } from "../../lib/stats-sync/sync.ts";

describe("logGhFailure", () => {
  let dir: string;
  let log: string;
  const writable = env as Record<string, string | undefined>;

  beforeEach(() => {
    dir = getFs().mkdtempSync!(getPath().join(getOs().tmpdir!(), "gh-failure-log-"));
    log = getPath().join(dir, "sync.log");
    writable["STATS_SYNC_LOG"] = log;
  });

  afterEach(() => {
    delete writable["STATS_SYNC_LOG"];
    getFs().rmSync(dir, { recursive: true, force: true });
  });

  it("writes gh's exit status and stderr to the job's log", () => {
    logGhFailure(new GhCommandError("gh pr list --repo x", 1, "HTTP 502: Bad Gateway\n"));
    expect(getFs().readFileSync(log, "utf8")).toBe("[gh] exit 1: gh pr list --repo x\nHTTP 502: Bad Gateway\n");
  });

  it("says so when gh printed nothing", () => {
    logGhFailure(new GhCommandError("gh api rate_limit", 4, ""));
    expect(getFs().readFileSync(log, "utf8")).toBe("[gh] exit 4: gh api rate_limit\n(no stderr)\n");
  });

  it("ignores errors that are not a failed command", () => {
    logGhFailure(new Error("boom"));
    expect(getFs().existsSync(log)).toBe(false);
  });
});
