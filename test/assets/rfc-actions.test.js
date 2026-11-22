// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * rfc-actions.js against the markup /rfc/<id> renders. The module is imported
 * once, as the browser runs it once per document; each test renders a fresh
 * body, as a Turbo Drive visit does, so every test also proves the listeners
 * outlive a swap.
 */
const page = (payload = '{"slug":"r","note":"","mode":"sunset"}') => {
  document.body.innerHTML = `
    <form data-confirm="Close it?" action="/rfc/r/status" method="post"><button>Close</button></form>
    <form action="/rfc/r/priority" method="post"><select data-autosubmit name="p"><option>1</option><option>2</option></select></form>
    <textarea data-relay-note>re-home to 0002</textarea>
    <button type="button" data-relay="spawnloop/rfc-refine" data-confirm="Sure?" data-payload='${payload}'>Sunset</button>
    <div data-relay-status hidden></div>`;
  return {
    button: document.querySelector("button[data-relay]"),
    note: document.querySelector("[data-relay-note]"),
    status: document.querySelector("[data-relay-status]"),
  };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("rfc-actions", () => {
  beforeAll(async () => {
    await import("../../app/assets/javascripts/rfc-actions.js");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts Sunset with the textarea's note, then clears it", async () => {
    const { button, note, status } = page();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetch = vi.fn(async () => new Response(""));
    vi.stubGlobal("fetch", fetch);
    button.click();
    await settle();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ slug: "r", note: "re-home to 0002", mode: "sunset" });
    expect(note.value).toBe("");
    expect(status.textContent).toContain("Agent spawned");
    expect(button.disabled).toBe(false);
  });

  it("keeps the note when ringo refuses", async () => {
    const { button, note, status } = page();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.stubGlobal("fetch", async () => new Response("busy", { status: 409 }));
    button.click();
    await settle();
    expect(note.value).toBe("re-home to 0002");
    expect(status.textContent).toBe("busy");
    expect(status.classList.contains("err")).toBe(true);
  });

  it("posts nothing when the relay is not confirmed", async () => {
    const { button } = page();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    button.click();
    await settle();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels a lifecycle form the user does not confirm", () => {
    page();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const event = new Event("submit", { bubbles: true, cancelable: true });
    document.querySelector("form[data-confirm]").dispatchEvent(event);
    expect(confirm).toHaveBeenCalledWith("Close it?");
    expect(event.defaultPrevented).toBe(true);
  });

  it("lets a confirmed lifecycle form through", () => {
    page();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const event = new Event("submit", { bubbles: true, cancelable: true });
    document.querySelector("form[data-confirm]").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("submits the priority form when its select changes", () => {
    page();
    const select = document.querySelector("select[data-autosubmit]");
    const requestSubmit = vi.spyOn(select.form, "requestSubmit").mockImplementation(() => {});
    select.value = "2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });
});
