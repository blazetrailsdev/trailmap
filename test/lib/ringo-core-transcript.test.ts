import { describe, expect, it } from "vitest";
import { parseTranscript } from "../../lib/ringo-core.ts";

describe("parseTranscript", () => {
  it("reads a session back into turns, a call married to its result", async () => {
    const tr = await parseTranscript(
      new TextEncoder().encode(
        [
          `{"type":"user","timestamp":"2026-08-26T14:00:00Z","message":{"content":"hi"}}`,
          `{"type":"assistant","timestamp":"2026-08-26T14:00:01Z","message":{"content":[{"type":"tool_use","id":"a","name":"Read","input":{"file_path":"x.ts"}}]}}`,
          `{"type":"user","timestamp":"2026-08-26T14:00:02Z","message":{"content":[{"type":"tool_result","tool_use_id":"a","content":"ok"}]}}`,
        ].join("\n"),
      ),
      20_000,
    );
    expect(tr.Turns!.map((t) => t.Prompt)).toEqual(["hi"]);
    expect(tr.Turns![0]!.Steps![0]!.Tool).toMatchObject({ Name: "Read", Summary: "x.ts", Output: "ok" });
    expect(tr.ToolCounts).toEqual({ Read: 1 });
  });

  it("skips a line past 4 MiB, counts it, and reads on", async () => {
    const huge = `{"type":"user","message":{"content":"${"x".repeat(4 << 20)}"}}`;
    const tr = await parseTranscript(
      new TextEncoder().encode([`{"type":"user","message":{"content":"first"}}`, huge, `{"type":"user","message":{"content":"second"}}`].join("\n")),
    );
    expect(tr.Oversized).toBe(1);
    expect(tr.Turns!.map((t) => t.Prompt)).toEqual(["first", "second"]);
  });
});
