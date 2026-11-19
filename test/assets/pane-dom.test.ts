// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PanesController } from "../../app/controllers/panes-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

/**
 * The pane page's code (`pane.js`) against the page the controller renders:
 * the key buttons and the focused screen press their key through the relay.
 */
const posts: Array<{ url: string; body: unknown }> = [];
const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  const tc = await controllerTestCase(PanesController);
  await tc.get("show", { params: { id: "42" } });
  const html = tc.response.body;
  if (!html.includes("paneKeys")) throw new Error(`pane page did not render: ${tc.response.status} ${html.slice(0, 300)}`);
  const page = new DOMParser().parseFromString(html, "text/html");
  for (const script of page.body.querySelectorAll("script[src]")) script.remove();
  document.body.replaceChildren(...page.body.childNodes);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ exists: true, status: "working", unchanged: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  await import("../../app/assets/javascripts/pane.js");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("the pane page's keys", () => {
  it("presses a button's key in the pane", async () => {
    posts.length = 0;
    (document.querySelector('#paneKeys [data-key="Down"]') as HTMLButtonElement).click();
    await settle();

    expect(posts).toEqual([{ url: "/fleet/pane/42/keys", body: { keys: ["Down"] } }]);
    expect(byId("paneSendResult").textContent).toBe("Down pressed");
  });

  it("forwards an arrow key from the focused screen, and leaves Tab alone", async () => {
    posts.length = 0;
    const screen = byId("paneScreen");
    screen.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    screen.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await settle();

    expect(posts).toEqual([{ url: "/fleet/pane/42/keys", body: { keys: ["Up"] } }]);
  });

  it("ignores a held key's auto-repeat and a press while one is in flight", async () => {
    posts.length = 0;
    const screen = byId("paneScreen");
    screen.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", repeat: true, bubbles: true, cancelable: true }));
    screen.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    screen.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    await settle();

    expect(posts).toEqual([{ url: "/fleet/pane/42/keys", body: { keys: ["Left"] } }]);
    expect(byId("paneSendResult").textContent).toBe("Left pressed");
  });
});
