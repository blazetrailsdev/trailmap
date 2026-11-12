import { Cli } from "@blazetrails/solid-queue/cli";
import { Supervisor } from "@blazetrails/solid-queue";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("bin/jobs entry point", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads -c and --skip-recurring from the command line", async () => {
    const start = vi
      .spyOn(Supervisor, "start")
      .mockResolvedValue(undefined as never);
    await Cli.start(["-c", "config/other.yml", "--skip-recurring"]);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        configFile: "config/other.yml",
        skipRecurring: true,
      }),
    );
  });
});
