import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * The image's NODE_OPTIONS makes SIGUSR2 print a diagnostic report to stdout,
 * which is `dokku logs`. Without `--report-exclude-env` that report carries the
 * whole environment, every secret dokku injects included. docs/deploy.md,
 * "Detecting a hang".
 */

const DOCKERFILE = new URL("../../Dockerfile", import.meta.url).pathname;

function imageNodeOptions(): string {
  const match = readFileSync(DOCKERFILE, "utf8").match(
    /^ENV NODE_OPTIONS="([^"]*)"$/m,
  );
  if (!match) throw new Error("Dockerfile sets no NODE_OPTIONS");
  return match[1];
}

function reportUnder(nodeOptions: string): string {
  return execFileSync(
    process.execPath,
    [
      ...nodeOptions.split(/\s+/).filter(Boolean),
      "-e",
      'process.kill(process.pid, "SIGUSR2"); setTimeout(() => {}, 500)',
    ],
    {
      env: {
        PATH: process.env.PATH,
        TRAILMAP_REPORT_CANARY: "canary-secret-value",
      },
      encoding: "utf8",
    },
  );
}

describe("Dockerfile NODE_OPTIONS", () => {
  it("prints a SIGUSR2 report to stdout", () => {
    expect(imageNodeOptions().split(/\s+/)).toEqual(
      expect.arrayContaining([
        "--report-on-signal",
        "--report-filename=stdout",
      ]),
    );
    expect(reportUnder(imageNodeOptions())).toContain('"javascriptStack"');
  });

  it("keeps the environment out of the report", () => {
    expect(reportUnder(imageNodeOptions())).not.toContain(
      "canary-secret-value",
    );
  });

  it("would leak the environment without --report-exclude-env", () => {
    const without = imageNodeOptions().replace("--report-exclude-env", "");
    expect(reportUnder(without)).toContain("canary-secret-value");
  });
});
