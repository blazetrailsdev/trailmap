import { describe, expect, it } from "vitest";
import { pagerFor, requestedPage } from "../../app/models/concerns/pager.js";

const href = (page: number) => `/list?page=${page}`;

describe("requestedPage", () => {
  it("reads digits and nothing else", () => {
    expect(requestedPage("3")).toBe(3);
    expect(requestedPage("2abc")).toBe(1);
    expect(requestedPage("1e3")).toBe(1);
    expect(requestedPage("-2")).toBe(1);
    expect(requestedPage(["2"])).toBe(1);
    expect(requestedPage(undefined)).toBe(1);
  });
});

describe("pagerFor", () => {
  it("places a middle page and links both neighbours", () => {
    expect(pagerFor(205, 100, 2, href)).toEqual({
      page: 2,
      pages: 3,
      total: 205,
      from: 101,
      to: 200,
      prevHref: "/list?page=1",
      nextHref: "/list?page=3",
    });
  });

  it("ends the last page at the total", () => {
    expect(pagerFor(205, 100, 3, href)).toMatchObject({ from: 201, to: 205, nextHref: null });
  });

  it("shows the last page for a page past the end, and the first for one before the start", () => {
    expect(pagerFor(205, 100, 99, href).page).toBe(3);
    expect(pagerFor(205, 100, 0, href).page).toBe(1);
  });

  it("is one empty page for an empty list", () => {
    expect(pagerFor(0, 100, 1, href)).toEqual({
      page: 1,
      pages: 1,
      total: 0,
      from: 0,
      to: 0,
      prevHref: null,
      nextHref: null,
    });
  });
});
