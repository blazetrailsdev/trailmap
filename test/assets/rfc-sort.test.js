// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

describe("rfc-sort.js", () => {
  it("follows the chosen option's link, keeping the default sort off the URL", async () => {
    document.body.innerHTML = `
      <select data-sort-menu>
        <option value="priority" data-href="/rfcs?status=draft" selected>priority</option>
        <option value="open" data-href="/rfcs?sort=open&amp;status=draft">most open</option>
      </select>`;
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    await import("../../app/assets/javascripts/rfc-sort.js");
    const select = document.querySelector("select");

    select.value = "open";
    select.dispatchEvent(new Event("change"));
    expect(assign).toHaveBeenLastCalledWith("/rfcs?sort=open&status=draft");

    select.value = "priority";
    select.dispatchEvent(new Event("change"));
    expect(assign).toHaveBeenLastCalledWith("/rfcs?status=draft");
  });

  it("binds the menu a Drive visit renders, through Turbo, once", () => {
    document.body.innerHTML = `
      <select data-sort-menu>
        <option value="priority" data-href="/rfcs" selected>priority</option>
        <option value="open" data-href="/rfcs?sort=open">most open</option>
      </select>`;
    const visit = vi.fn();
    window.Turbo = { visit };
    document.dispatchEvent(new Event("turbo:load"));
    document.dispatchEvent(new Event("turbo:load"));
    const select = document.querySelector("select");
    select.value = "open";
    select.dispatchEvent(new Event("change"));
    expect(visit).toHaveBeenCalledTimes(1);
    expect(visit).toHaveBeenCalledWith("/rfcs?sort=open");
    delete window.Turbo;
  });
});
