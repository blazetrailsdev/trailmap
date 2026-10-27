import { describe, expect, it } from "vitest";
import { sseData } from "../../lib/sse.ts";

describe("sseData", () => {
  it("returns each complete event's data and keeps the unfinished tail", () => {
    expect(sseData('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"')).toEqual({
      data: ['{"a":1}', '{"b":2}'],
      rest: 'data: {"c"',
    });
  });

  it("finishes an event when the tail is handed back with the next chunk", () => {
    const first = sseData('data: {"c"');
    const second = sseData(first.rest + ':3}\n\n');

    expect(first.data).toEqual([]);
    expect(second).toEqual({ data: ['{"c":3}'], rest: "" });
  });

  it("joins a multi-line data field and drops comments and other fields", () => {
    expect(sseData(": keep-alive\n\nevent: tick\nid: 7\ndata: one\ndata: two\n\n")).toEqual({
      data: ["one\ntwo"],
      rest: "",
    });
  });

  it("reads CRLF and bare-CR framing", () => {
    expect(sseData("data: x\r\n\r\n").data).toEqual(["x"]);
    expect(sseData("data: y\r\rdata: z\r\rdata: w").data).toEqual(["y", "z"]);
  });

  it("holds a trailing CR until the next chunk says whether it is half of a CRLF", () => {
    const first = sseData("data: x\r\n\r");
    const second = sseData(first.rest + "\ndata: y\r\n\r\n");

    expect(first).toEqual({ data: [], rest: "data: x\n\r" });
    expect(second.data).toEqual(["x", "y"]);
  });
});
