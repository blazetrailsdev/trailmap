// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

/**
 * rfc-actions.js under Turbo Drive: a restored snapshot is a clone of <body>,
 * with every attribute and none of the listeners, so `turbo:load` must bind
 * the clone's confirm forms, relay buttons and autosubmit selects again.
 */
describe("rfc-actions.js on a restored snapshot", () => {
  it("binds the clone's forms, relay buttons and selects", async () => {
    document.body.innerHTML = `
      <form data-confirm="Sure?"><button>Go</button></form>
      <button data-relay="spawnloop/rfc-refine" data-confirm="Spawn?" data-payload="{}">Refine</button>
      <p data-relay-status hidden></p>
      <form><select data-autosubmit><option>a</option><option>b</option></select></form>`;
    await import("../../app/assets/javascripts/rfc-actions.js");

    document.body.replaceWith(document.body.cloneNode(true));
    document.dispatchEvent(new Event("turbo:load"));

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const submit = new Event("submit", { cancelable: true });
    document.querySelector("form[data-confirm]").dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);

    document.querySelector("button[data-relay]").click();
    expect(confirm).toHaveBeenCalledWith("Spawn?");

    const select = document.querySelector("select[data-autosubmit]");
    const requestSubmit = vi.spyOn(select.form, "requestSubmit").mockImplementation(() => {});
    select.dispatchEvent(new Event("change"));
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });
});
