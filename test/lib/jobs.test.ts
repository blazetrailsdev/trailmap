import { getFs } from "@blazetrails/ruby-compat";
import { describe, expect, it } from "vitest";

// lib/jobs.ts starts the supervisor as it loads, so it cannot be imported here.
describe("bin/jobs entry point", () => {
  it("loads the job classes only after the application has booted", async () => {
    const source = await getFs().readFile("lib/jobs.ts", "utf8");
    expect(source).not.toMatch(/^import [^(]*app\/jobs/m);
    expect(source).toContain('await import("../app/jobs/index.ts");');
  });
});
