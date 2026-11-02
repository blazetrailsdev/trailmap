import { getFs } from "@blazetrails/ruby-compat";
import { Cli } from "@blazetrails/solid-queue/cli";
import { Supervisor } from "@blazetrails/solid-queue";
import { afterEach, describe, expect, it, vi } from "vitest";

// lib/jobs.ts starts the supervisor as it loads, so it cannot be imported here.
describe("bin/jobs entry point", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hands ARGV to the CLI, as bin/jobs does", async () => {
    const source = await getFs().readFile("lib/jobs.ts", "utf8");
    expect(source).toContain(".start(rbArgv());");
  });

  it("reads -c and --skip-recurring from the command line", async () => {
    const start = vi.spyOn(Supervisor, "start").mockResolvedValue(undefined as never);
    await (Cli as unknown as { start(argv: string[]): Promise<unknown> }).start(["-c", "config/other.yml", "--skip-recurring"]);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ configFile: "config/other.yml", skipRecurring: true }),
    );
  });

  it("loads the job classes only after the application has booted", async () => {
    const source = await getFs().readFile("lib/jobs.ts", "utf8");
    expect(source).not.toMatch(/^import [^(]*app\/jobs/m);
    expect(source).toContain('await import("../app/jobs/index.ts");');
  });
});
