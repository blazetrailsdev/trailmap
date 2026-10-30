import { afterEach, describe, expect, it, vi } from "vitest";

/** Just enough DOM for rfc-actions.js: one button, the note and the status line. */
function page(payload) {
  const listeners = {};
  const button = {
    dataset: { relay: "spawnloop/rfc-refine", payload, confirm: "Sure?" },
    addEventListener: (type, fn) => (listeners[type] = fn),
  };
  const note = { value: "re-home to 0002" };
  const status = { classList: { toggle() {} } };
  vi.stubGlobal("window", { confirm: () => true });
  vi.stubGlobal("document", {
    querySelectorAll: (selector) => (selector === "button[data-relay]" ? [button] : []),
    querySelector: (selector) =>
      selector === "[data-relay-note]" ? note : selector === "[data-relay-status]" ? status : null,
  });
  return { listeners, note, status };
}

describe("rfc-actions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("posts Sunset with the textarea's note, then clears it", async () => {
    const { listeners, note, status } = page('{"slug":"r","note":"","mode":"sunset"}');
    const fetch = vi.fn(async () => new Response(""));
    vi.stubGlobal("fetch", fetch);
    await import("../../app/assets/javascripts/rfc-actions.js");
    await listeners.click();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ slug: "r", note: "re-home to 0002", mode: "sunset" });
    expect(note.value).toBe("");
    expect(status.textContent).toContain("Agent spawned");
  });

  it("keeps the note when ringo refuses", async () => {
    const { listeners, note, status } = page('{"slug":"r","note":"","mode":"sunset"}');
    vi.stubGlobal("fetch", async () => new Response("busy", { status: 409 }));
    await import("../../app/assets/javascripts/rfc-actions.js");
    await listeners.click();
    expect(note.value).toBe("re-home to 0002");
    expect(status.textContent).toBe("busy");
  });
});
