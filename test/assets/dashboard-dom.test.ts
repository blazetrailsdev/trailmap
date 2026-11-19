// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setX } from "../support/config-x.ts";
import { DashboardController } from "../../app/controllers/dashboard-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

/**
 * The dashboard's page code (`dashboard.js`) against the page the controller
 * renders, in a DOM. The outcome rules are unit-tested in `fleet-format`;
 * this is the wiring: the palette opening and closing, the header field
 * carrying a key or a paste into it, and the spawn dialog.
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
  if (url.endsWith("/broadcast-targets")) {
    return new Response(JSON.stringify({ all: 3, "ci-red": 1 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.startsWith("/fleet/stories")) {
    searches.push(new URL(url, "http://test").searchParams.get("q") ?? "");
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("", { status: 503 });
}

beforeAll(async () => {
  setX("fleet", "repoPaths", "blazetrailsdev/tasks=/srv/tasks,blazetrailsdev/trailmap=/srv/trailmap,blazetrailsdev/trails=/srv/trails");
  const tc = await controllerTestCase(DashboardController);
  await tc.get("index");
  setX("fleet", "repoPaths", undefined);
  const html = tc.response.body;
  if (!html.includes("paletteInput")) throw new Error(`dashboard did not render: ${tc.response.status} ${html.slice(0, 300)}`);
  const page = new DOMParser().parseFromString(html, "text/html");
  // The page's own module script is dropped: the module is imported below.
  for (const script of page.body.querySelectorAll("script[src]")) script.remove();
  document.body.replaceChildren(...page.body.childNodes);

  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, String(v)),
    removeItem: (k: string) => void stored.delete(k),
  });
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

});

describe("the spawn dialog", () => {
  const dialog = (): HTMLDialogElement => byId("spawnDialog") as HTMLDialogElement;
  const task = (): HTMLTextAreaElement => byId("spawnTask") as HTMLTextAreaElement;
  const chips = (): string[] => [...byId("spawnRepos").querySelectorAll("[data-name]")].map((c) => (c as HTMLElement).dataset.name ?? "");
  const picked = (): string | undefined => (byId("spawnRepos").querySelector('[aria-checked="true"]') as HTMLElement | null)?.dataset.name;
  const key = (init: KeyboardEventInit): void => {
    task().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  };

  it("offers trails, trailmap and tasks in that order, trails picked", () => {
    byId("spawnBtn").click();
    expect(dialog().open).toBe(true);
    expect(palette().open).toBe(false);
    expect(chips()).toEqual(["blazetrailsdev/trails", "blazetrailsdev/trailmap", "blazetrailsdev/tasks"]);
    expect(picked()).toBe("blazetrailsdev/trails");
    expect(document.activeElement).toBe(task());
  });

  it("picks a repo by its place and moves it along the row, keeping the order", () => {
    key({ altKey: true, code: "Digit3", key: "£" });
    expect(picked()).toBe("blazetrailsdev/tasks");
    key({ altKey: true, code: "BracketLeft", key: "“" });
    expect(chips()).toEqual(["blazetrailsdev/trails", "blazetrailsdev/tasks", "blazetrailsdev/trailmap"]);
    expect(JSON.parse(localStorage.getItem("trailmap.spawnRepoOrder") ?? "null")).toEqual(chips());
    key({ altKey: true, code: "Digit0", key: "º" });
    expect(chips()).toEqual(["blazetrailsdev/trails", "blazetrailsdev/trailmap", "blazetrailsdev/tasks"]);
    expect(localStorage.getItem("trailmap.spawnRepoOrder")).toBeNull();
    key({ altKey: true, code: "Digit1", key: "¡" });
  });

  it("leaves a bare Enter to the task box, and suggests the worktree name from its first line", () => {
    task().value = "Fix the build\nand more";
    task().dispatchEvent(new Event("input"));
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    task().dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect((byId("spawnName") as HTMLInputElement).placeholder).toBe("fix-the-build");
  });

  it("asks for a task on ⌘↵ with an empty box, and posts nothing", () => {
    const before = posts.length;
    task().value = "  ";
    key({ key: "Enter", metaKey: true });
    expect(posts.length).toBe(before);
    expect(byId("spawnStatus").textContent).toBe("Describe the task first.");
    expect(document.activeElement).toBe(task());
  });

  it("spawns on ⌘↵ the way the loop does, closes, and writes its report beside the page's search", async () => {
    task().value = " fix the build ";
    key({ key: "Enter", metaKey: true });

    // The report is the last thing the spawn writes; wait for it rather than
    // for a fixed turn, which a loaded machine overruns.
    await vi.waitFor(() => expect(byId("paletteDone").textContent).toContain("spawned in %5"), { timeout: 5000 });
    expect(posts.at(-1)).toEqual({ url: "/fleet/control/spawnloop/dashboard-spawn", body: { repoDir: "/srv/trails", message: "fix the build" } });
    expect(dialog().open).toBe(false);
    expect(task().value).toBe("");
    expect((byId("spawnName") as HTMLInputElement).placeholder).toBe("task");
  });

  it("carries the palette's text into the dialog from its spawn action", () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    input().value = "a long task";
    input().dispatchEvent(new Event("input"));
    const spawn = [...palette().querySelectorAll('[data-ui="palette-pick"]')].find((el) => el.textContent?.includes("Spawn")) as HTMLElement;
    spawn.click();
    expect(palette().open).toBe(false);
    expect(dialog().open).toBe(true);
    expect(task().value).toBe("a long task");
    dialog().close();
  });
});

describe("the broadcast dialog", () => {
  const dialog = (): HTMLDialogElement => byId("broadcastDialog") as HTMLDialogElement;
  const box = (): HTMLTextAreaElement => byId("broadcastMessage") as HTMLTextAreaElement;

  it("opens from the toolbar on its own message box, not the palette", () => {
    byId("broadcastBtn").click();
    expect(dialog().open).toBe(true);
    expect(palette().open).toBe(false);
    expect(document.activeElement).toBe(box());
  });

  it("leaves a bare Enter to the message box", () => {
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    box().dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
  });

  it("closes on Cancel", () => {
    (dialog().querySelector(".palette-cancel") as HTMLElement).click();
    expect(dialog().open).toBe(false);
  });

  it("carries the palette's text into the dialog from its broadcast action", () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    input().value = "please rebase";
    input().dispatchEvent(new Event("input"));
    const action = [...palette().querySelectorAll('[data-ui="palette-pick"]')].find((el) => el.textContent?.includes("Broadcast")) as HTMLElement;
    action.click();
    expect(palette().open).toBe(false);
    expect(dialog().open).toBe(true);
    expect(box().value).toBe("please rebase");
    dialog().close();
  });

  it("sends the palette's CI-red action to the CI-red agents on ⌘↵, as its footer says", async () => {
    vi.stubGlobal("confirm", () => true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    input().value = "fix CI";
    input().dispatchEvent(new Event("input"));
    const action = [...palette().querySelectorAll('[data-ui="palette-pick"]')].find((el) => el.textContent?.includes("CI-red agents")) as HTMLElement;
    action.click();
    expect(dialog().open).toBe(true);
    expect(byId("bcastKeyHint").textContent).toBe("send to CI red");
    box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }));
    await settle(50);
    expect(posts.at(-1)).toEqual({ url: "/fleet/control/broadcast", body: { message: "fix CI", target: "ci-red" } });
    dialog().close();
  });

  it("aims ⌘↵ back at everyone when opened from the toolbar", () => {
    byId("broadcastBtn").click();
    expect(byId("bcastKeyHint").textContent).toBe("send to all");
    dialog().close();
  });
});
