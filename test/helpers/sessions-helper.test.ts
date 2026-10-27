import { describe, expect, it } from "vitest";
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
});
