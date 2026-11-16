import { describe, expect, it } from "vitest";
import { navMark } from "../../app/helpers/application-helper.ts";

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
});
