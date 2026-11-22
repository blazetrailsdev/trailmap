// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const menu = () => {
  document.body.innerHTML = `
    <select data-sort-menu>
      <option value="priority" data-href="/rfcs?status=draft" selected>priority</option>
      <option value="open" data-href="/rfcs?sort=open&amp;status=draft">most open</option>
    </select>`;
  return document.querySelector("select");
};
const choose = (select, value) => {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("rfc-sort.js", () => {
  beforeAll(async () => {
    await import("../../app/assets/javascripts/rfc-sort.js");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.Turbo;
  });

  it("follows the chosen option's link, keeping the default sort off the URL", () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const select = menu();
    choose(select, "open");
    expect(assign).toHaveBeenLastCalledWith("/rfcs?sort=open&status=draft");
    choose(select, "priority");
    expect(assign).toHaveBeenLastCalledWith("/rfcs?status=draft");
  });

  it("visits through Turbo Drive when it is loaded", () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    window.Turbo = { visit: vi.fn() };
    choose(menu(), "open");
    expect(window.Turbo.visit).toHaveBeenCalledWith("/rfcs?sort=open&status=draft");
    expect(assign).not.toHaveBeenCalled();
  });

  it("works on a menu Drive swapped in after the script ran", () => {
    // The module is not imported again: a Drive visit never re-runs it.
    window.Turbo = { visit: vi.fn() };
    const swapped = menu();
    choose(swapped, "open");
    expect(window.Turbo.visit).toHaveBeenCalledTimes(1);
  });
});
