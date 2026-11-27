// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `application.js`: Turbo Drive, and a full load whenever the page being left
 * opted out with turbo-visit-control "reload".
 */
vi.mock("@hotwired/turbo", () => ({}));

const reload = vi.fn();

const optOut = (on: boolean): void => {
  document.head.innerHTML = on ? '<meta name="turbo-visit-control" content="reload">' : "";
};
const visit = (action: string): void => {
  document.dispatchEvent(new CustomEvent("turbo:visit", { detail: { url: "/x", action } }));
};

describe("application.js", () => {
  beforeAll(async () => {
    Object.defineProperty(window, "location", { value: { reload }, configurable: true });
    optOut(true);
    await import("../../app/assets/javascripts/application.js");
  });
  beforeEach(() => reload.mockClear());

  it("hands a reload page's links and forms to the browser", () => {
    // Turbo skips any link or form under data-turbo="false", so a form on a
    // reload page POSTs natively instead of by fetch.
    document.body.innerHTML = '<form action="/rfc/1/status" method="post"><button>Go</button></form>';
    expect(document.body.dataset.turbo).toBe("false");
    expect(document.querySelector("form")?.closest('[data-turbo="false"]')).toBe(document.body);
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

describe("application.js on a Drive page", () => {
  it("leaves <body> to Turbo", async () => {
    vi.resetModules();
    optOut(false);
    delete document.body.dataset.turbo;
    await import("../../app/assets/javascripts/application.js");
    expect(document.body.dataset.turbo).toBeUndefined();
  });
});
