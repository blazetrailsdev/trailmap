// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setX } from "../support/config-x.ts";
import { DashboardController } from "../../app/controllers/dashboard-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

/**
 * The dashboard's page code (`dashboard.js`) against the page the controller
 * renders, in a DOM. The outcome rules are unit-tested in `fleet-format`;
 * this is the wiring: the palette opening and closing, the header field
 * carrying a key or a paste into it, and a spawn's report.
 */
const posts: Array<{ url: string; body: unknown }> = [];
const searches: string[] = [];
const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const palette = (): HTMLDialogElement => byId("palette") as HTMLDialogElement;
const input = (): HTMLInputElement => byId("paletteInput") as HTMLInputElement;
const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function answer(url: string, init?: RequestInit): Response {
  if (init?.method === "POST") {
    posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    return new Response("spawned in %5", { status: 200 });
  }
  if (url.startsWith("/fleet/stories")) {
    searches.push(new URL(url, "http://test").searchParams.get("q") ?? "");
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("", { status: 503 });
}

beforeAll(async () => {
  setX("fleet", "repoPaths", "blazetrailsdev/trails=/srv/trails");
  const tc = await controllerTestCase(DashboardController);
  await tc.get("index");
  setX("fleet", "repoPaths", undefined);
  const html = tc.response.body;
  if (!html.includes("paletteInput")) throw new Error(`dashboard did not render: ${tc.response.status} ${html.slice(0, 300)}`);
  const page = new DOMParser().parseFromString(html, "text/html");
  // The page's own module script is dropped: the module is imported below.
  for (const script of page.body.querySelectorAll("script[src]")) script.remove();
  document.body.replaceChildren(...page.body.childNodes);

  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => answer(String(url), init)));
  vi.stubGlobal(
    "WebSocket",
    class {
      close(): void {}
    },
  );
  await import("../../app/assets/javascripts/dashboard.js");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** What a browser does on Esc in a modal dialog: a cancel, then the close. */
function pressEscape(): void {
  palette().dispatchEvent(new Event("cancel", { cancelable: true }));
  palette().close();
}

describe("the dashboard palette", () => {
  it("closes on Esc and stays closed when focus returns to the header field", async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    expect(palette().open).toBe(true);

    pressEscape();
    byId("fleetSearch").focus();
    byId("fleetSearch").dispatchEvent(new FocusEvent("focus"));
    await settle();

    expect(palette().open).toBe(false);
  });

  it("closes from its X and from Cancel", () => {
    for (const cls of ["palette-x", "palette-cancel"]) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
      expect(palette().open).toBe(true);
      (palette().querySelector(`.${cls}`) as HTMLElement).click();
      expect(palette().open, cls).toBe(false);
    }
  });

  it("carries a key typed into the header field into the palette, and searches stories for it", async () => {
    input().value = "ab";
    palette().close();
    byId("fleetSearch").dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true, cancelable: true }));

    expect(palette().open).toBe(true);
    expect(input().value).toBe("abc");
    await settle(250);
    expect(searches.at(-1)).toBe("abc");
    palette().close();
  });

  it("carries a paste into the header field into the palette, and searches stories for it", async () => {
    input().value = "";
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "pasted query" } });
    byId("fleetSearch").dispatchEvent(paste);

    expect(palette().open).toBe(true);
    expect(input().value).toBe("pasted query");
    await settle(250);
    expect(searches.at(-1)).toBe("pasted query");
    palette().close();
  });

  it("closes on a successful spawn and writes its report beside the page's search", async () => {
    byId("spawnBtn").click();
    expect(palette().open).toBe(true);
    input().value = " fix the build ";
    byId("spawn").click();
    await settle(50);

    expect(posts.at(-1)).toEqual({ url: "/fleet/control/spawn", body: { repoDir: "/srv/trails", message: "fix the build" } });
    expect(palette().open).toBe(false);
    expect(byId("paletteDone").textContent).toContain("spawned in %5");
  });
});
