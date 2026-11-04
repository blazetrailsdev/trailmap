import { getFs, rbArgv } from "@blazetrails/ruby-compat";
import { Cli } from "@blazetrails/solid-queue/cli";
import { Supervisor } from "@blazetrails/solid-queue";
import { afterEach, describe, expect, it, vi } from "vitest";

// lib/jobs.ts boots the application and starts the supervisor as it loads.
vi.mock("../../config/environment.ts", () => ({}));

describe("bin/jobs entry point", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hands ARGV to the CLI, as bin/jobs does", async () => {
    const start = vi
      .spyOn(Supervisor, "start")
      .mockResolvedValue(undefined as never);
    const argv = [...rbArgv()];
    rbArgv().splice(0, Infinity, "-c", "config/other.yml", "--skip-recurring");
    try {
      await import("../../lib/jobs.ts");
    } finally {
      rbArgv().splice(0, Infinity, ...argv);
    }
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        configFile: "config/other.yml",
        skipRecurring: true,
      }),
    );
  });

  it("reads -c and --skip-recurring from the command line", async () => {
    const start = vi
      .spyOn(Supervisor, "start")
      .mockResolvedValue(undefined as never);
    await (Cli as unknown as { start(argv: string[]): Promise<unknown> }).start(
      ["-c", "config/other.yml", "--skip-recurring"],
    );
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        configFile: "config/other.yml",
        skipRecurring: true,
      }),
    );
  });

});
