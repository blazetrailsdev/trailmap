import { describe, expect, it } from "vitest";
import { sseData } from "../../lib/sse.js";

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

  it("reads CRLF framing", () => {
    expect(sseData("data: x\r\n\r\n").data).toEqual(["x"]);
  });
});
