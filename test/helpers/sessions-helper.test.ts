import { describe, expect, it } from "vitest";
import type { Transcript, TranscriptToolCall } from "../../lib/ringo-core.ts";
import { SessionsHelper } from "../../app/helpers/sessions-helper.ts";

describe("SessionsHelper", () => {
  it("sessionTime prints the wall clock in ringo's offset", () => {
    expect(SessionsHelper.sessionTime("2026-10-07T07:44:36.18-04:00")).toBe("Oct 7 07:44");
    expect(SessionsHelper.sessionTime("garbage")).toBe("garbage");
  });

  it("shortDur", () => {
    expect(SessionsHelper.shortDur(59_000)).toBe("<1m");
    expect(SessionsHelper.shortDur(42 * 60_000)).toBe("42m");
    expect(SessionsHelper.shortDur(185 * 60_000)).toBe("3h05m");
  });

  it("money", () => {
    expect(SessionsHelper.money(0)).toBe("—");
    expect(SessionsHelper.money(1.255)).toBe("$1.25");
  });

  it("humanBytes", () => {
    expect(SessionsHelper.humanBytes(512)).toBe("512 B");
    expect(SessionsHelper.humanBytes(2048)).toBe("2.0 KB");
    expect(SessionsHelper.humanBytes(3 * 2 ** 20)).toBe("3.0 MB");
    expect(SessionsHelper.humanBytes(5 * 2 ** 30)).toBe("5.0 GB");
  });

  it("shortId", () => {
    expect(SessionsHelper.shortId("0123456789abcdef")).toBe("0123456789ab…");
    expect(SessionsHelper.shortId("short")).toBe("short");
  });

  it("orDash", () => {
    expect(SessionsHelper.orDash("")).toBe("—");
    expect(SessionsHelper.orDash(undefined)).toBe("—");
    expect(SessionsHelper.orDash("main")).toBe("main");
  });

  it("clock", () => {
    expect(SessionsHelper.clock("2026-08-26T14:00:01.123Z")).toBe("14:00:01");
    expect(SessionsHelper.clock("0001-01-01T00:00:00Z")).toBe("");
  });

  it("callMs", () => {
    const call = { StartedAt: "2026-08-26T14:00:00Z", EndedAt: "2026-08-26T14:00:12.5Z" } as TranscriptToolCall;
    expect(SessionsHelper.callMs(call)).toBe(12_500);
    expect(SessionsHelper.callMs({ ...call, EndedAt: "0001-01-01T00:00:00Z" })).toBe(0);
    expect(SessionsHelper.callMs({ ...call, EndedAt: "2026-08-26T13:59:00Z" })).toBe(0);
  });

  it("wallMs", () => {
    expect(SessionsHelper.wallMs({ FirstAt: "2026-08-26T14:00:00Z", LastAt: "2026-08-26T15:00:00Z" } as Transcript)).toBe(3_600_000);
  });

  it("toolDur", () => {
    expect(SessionsHelper.toolDur(0)).toBe("");
    expect(SessionsHelper.toolDur(30)).toBe("30ms");
    expect(SessionsHelper.toolDur(1500)).toBe("1.5s");
    expect(SessionsHelper.toolDur(1650)).toBe("1.6s");
    expect(SessionsHelper.toolDur(600_000)).toBe("10m00s");
  });

  it("clip", () => {
    expect(SessionsHelper.clip("short", 10)).toBe("short");
    expect(SessionsHelper.clip("abcdef", 4)).toBe("abcd\n… clipped, 2 B more");
  });

  it("firstLine", () => {
    expect(SessionsHelper.firstLine("  one  ")).toBe("one");
    expect(SessionsHelper.firstLine("one\ntwo")).toBe("one …");
    expect(SessionsHelper.firstLine("x".repeat(100))).toBe(`${"x".repeat(96)} …`);
  });

  it("byteLength", () => {
    expect(SessionsHelper.byteLength("é")).toBe(2);
  });

  it("plural", () => {
    expect(SessionsHelper.plural(1, "prompt", "prompts")).toBe("prompt");
    expect(SessionsHelper.plural(2, "prompt", "prompts")).toBe("prompts");
  });

  it("reviewedFrom", () => {
    expect(SessionsHelper.reviewedFrom("/w/trails-reviews/pr-9430")).toBe(true);
    expect(SessionsHelper.reviewedFrom("/w/trails")).toBe(false);
  });
});
