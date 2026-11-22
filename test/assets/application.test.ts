// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `application.js`: Turbo Drive, and a full load whenever the page being left
 * opted out with turbo-visit-control "reload".
 */
vi.mock("@hotwired/turbo", () => ({}));

const assign = vi.fn();
const reload = vi.fn();

const optOut = (on: boolean): void => {
  document.head.innerHTML = on ? '<meta name="turbo-visit-control" content="reload">' : "";
};
const beforeVisit = (url: string): CustomEvent => {
  const event = new CustomEvent("turbo:before-visit", { cancelable: true, detail: { url } });
  document.dispatchEvent(event);
  return event;
};
const visit = (action: string): void => {
  document.dispatchEvent(new CustomEvent("turbo:visit", { detail: { url: "/x", action } }));
};

describe("application.js", () => {
  beforeAll(async () => {
    Object.defineProperty(window, "location", { value: { assign, reload }, configurable: true });
    await import("../../app/assets/javascripts/application.js");
  });
  beforeEach(() => {
    assign.mockClear();
    reload.mockClear();
  });

  it("lets Drive visit from a page that did not opt out", () => {
    optOut(false);
    expect(beforeVisit("/backlog").defaultPrevented).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("full-loads the visit when leaving a reload page", () => {
    optOut(true);
    expect(beforeVisit("/backlog").defaultPrevented).toBe(true);
    expect(assign).toHaveBeenCalledWith("/backlog");
  });

  it("reloads a Back or Forward away from a reload page", () => {
    optOut(true);
    visit("restore");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("leaves advance visits and ordinary restores alone", () => {
    optOut(true);
    visit("advance");
    optOut(false);
    visit("restore");
    expect(reload).not.toHaveBeenCalled();
  });
});
