// @vitest-environment happy-dom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pulls tab's External inbox (`external-prs.js`) booted on an
 * `#externalPrs` root, with ringo's reads, the control relay and the fleet
 * socket stubbed. Each case is one of the bugs #189's review rounds fixed.
 */
const repo = "acme/widgets";
const now = new Date().toISOString();
const pr = (n: number) => ({ repo, pr: n, title: `PR ${n}`, author: "ext", lastActivityAt: now });

let prs = [pr(1), pr(2)];
let draftFails = new Set<number>();
let startStatus = 200;
let listDelay: (() => Promise<void>) | null = null;
let listReads = 0;
const sockets: Array<{ onmessage: ((m: { data: string }) => void) | null }> = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const list = () => document.querySelector("#externalPrs .external-list") as HTMLElement;
const rows = () => [...list().querySelectorAll(".row-title")].map((a) => a.textContent);
const send = (events: unknown[]) => sockets.at(-1)!.onmessage!({ data: JSON.stringify({ events }) });
let clock = Date.now();
const event = (type: string, fields: Record<string, unknown>) => ({ type, fields, at: new Date((clock += 1000)).toISOString() });

beforeAll(async () => {
  document.body.innerHTML = `<div id="externalPrs" data-repo="${repo}" data-read="/fleet/read" data-control="/fleet/control" data-socket="/fleet/socket"><div class="external-list"></div></div>`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (init?.method === "POST") return startStatus === 200 ? json({}) : new Response("agent busy", { status: startStatus });
      if (path === "/fleet/read/external-prs") {
        listReads += 1;
        const snapshot = prs;
        if (listDelay) await listDelay();
        return json(snapshot);
      }
      if (path.startsWith("/fleet/read/external-review")) {
        const n = Number(new URL(path, "http://x").searchParams.get("pr"));
        if (draftFails.has(n)) throw new Error("draft read failed");
        return json(null);
      }
      return json([]);
    }),
  );
  vi.stubGlobal(
    "WebSocket",
    class {
      onmessage: ((m: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() {
        sockets.push(this);
      }
    },
  );
  await import("../../app/assets/javascripts/external-prs.js");
  await settle(5);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  prs = [pr(1), pr(2)];
  draftFails = new Set();
  startStatus = 200;
  listDelay = null;
  send([event("external_pr.updated", { repo })]);
  await settle(5);
});

describe("the External inbox", () => {
  it("renders a failed start's error in its row", async () => {
    startStatus = 409;
    (list().querySelector(".external-actions button") as HTMLButtonElement).click();
    await settle(5);

    expect(list().querySelector(".external-error")?.textContent).toBe("Could not start: agent busy");
  });

  it("keeps a focus note and its caret across a redraw for the same repo", async () => {
    const focus = list().querySelector('.external-focus[data-pr="2"]') as HTMLInputElement;
    focus.focus();
    focus.value = "look at the parser";
    focus.dispatchEvent(new Event("input"));
    focus.setSelectionRange(3, 5);
    send([event("external_pr.updated", { repo })]);
    await settle(5);

    const again = list().querySelector('.external-focus[data-pr="2"]') as HTMLInputElement;
    expect(again).not.toBe(focus);
    expect(again.value).toBe("look at the parser");
    expect(document.activeElement).toBe(again);
    expect([again.selectionStart, again.selectionEnd]).toEqual([3, 5]);
  });

  it("does not redraw on another repo's event", async () => {
    const before = listReads;
    send([event("external_pr.updated", { repo: "acme/other" })]);
    await settle(5);

    expect(listReads).toBe(before);
  });

  it("draws the other rows when one draft read throws", async () => {
    draftFails = new Set([1]);
    send([event("external_pr.updated", { repo })]);
    await settle(5);

    expect(rows()).toEqual(["#1 PR 1", "#2 PR 2"]);
  });

  it("clears a pending start on external_review.drafted", async () => {
    (list().querySelector(".external-actions button") as HTMLButtonElement).click();
    await settle(5);
    expect(list().querySelector(".tag.prog")?.textContent).toBe("drafting");

    send([event("external_review.drafted", { repo, pr: 1 })]);
    await settle(5);
    expect(list().querySelector(".tag.prog")?.textContent).toBe("none");
  });

  it("does not let a stale draw that resolves last overwrite a newer one", async () => {
    let releaseOld!: () => void;
    const old = new Promise<void>((resolve) => (releaseOld = resolve));
    listDelay = () => old;
    send([event("external_pr.updated", { repo })]);
    await settle(1);
    listDelay = null;
    prs = [pr(3)];
    send([event("external_pr.updated", { repo })]);
    await settle(5);
    releaseOld();
    await settle(5);

    expect(rows()).toEqual(["#3 PR 3"]);
  });
});
