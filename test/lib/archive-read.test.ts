import { describe, expect, it } from "vitest";
import { readBounded } from "../../lib/archive-read.ts";

function stream(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("readBounded", () => {
  it("keeps a stream within the bound whole", async () => {
    const read = await readBounded(stream("ab", "cd"), 10, "head");
    expect([text(read.bytes), read.total, read.truncated]).toEqual(["abcd", 4, false]);
  });

  it("keeps the head and stops reading past the bound", async () => {
    const read = await readBounded(stream("abc", "def", "ghi"), 4, "head");
    expect(text(read.bytes)).toBe("abcd");
    expect(read.truncated).toBe(true);
  });

  it("keeps the tail of a stream past the bound", async () => {
    const read = await readBounded(stream("abc", "def", "ghi"), 4, "tail");
    expect([text(read.bytes), read.total, read.truncated]).toEqual(["fghi", 9, true]);
  });

  it("calls a stream exactly the bound long whole", async () => {
    const read = await readBounded(stream("ab", "cd"), 4, "tail");
    expect([text(read.bytes), read.truncated]).toEqual(["abcd", false]);
  });
});
