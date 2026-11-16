import { describe, expect, it } from "vitest";
import { ApplicationHelper } from "../../app/helpers/application-helper.ts";

const { navMark } = ApplicationHelper;
const on = (path: string, method = "GET") => ({ request: { path, method } });

describe("ApplicationHelper", () => {
  it("nav_mark marks the exact page and the section a page is in", () => {
    expect(navMark("/rfcs", "/rfcs")).toBe("page");
    expect(navMark("/rfcs", "/rfc/0234-no-void-promises")).toBe("section");
    expect(navMark("/backlog", "/story/a-story")).toBe("section");
    expect(navMark("/packages", "/packages/activerecord/files")).toBe("section");
    expect(navMark("/sessions", "/panes/42")).toBe("section");
    expect(navMark("/packages", "/packagesx")).toBeNull();
    expect(navMark("/rfcs", "/backlog")).toBeNull();
  });

  it("nav_mark reads the request, marking only a GET or HEAD", () => {
    expect(navMark.call(on("/rfcs"), "/rfcs")).toBe("page");
    expect(navMark.call(on("/rfcs", "HEAD"), "/rfcs")).toBe("page");
    expect(navMark.call(on("/rfcs", "POST"), "/rfcs")).toBeNull();
    expect(() => navMark.call({}, "/rfcs")).toThrow(/Request object/);
  });

  it("nav_mark unescapes both sides", () => {
    expect(navMark("/rfcs", "/rfc%73")).toBe("page");
    expect(navMark("/packages", "/packages/a%20b")).toBe("section");
    expect(navMark("/rfcs/", "/rfcs")).toBe("page");
    expect(navMark("/sessions/", "/panes/42")).toBe("section");
  });
});
