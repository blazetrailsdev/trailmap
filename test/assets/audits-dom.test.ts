// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";

/**
 * `audits.js` against the viewer markup `audits/index` renders: the button,
 * `f` and Escape lift the open report over the page and put it back.
 */
const viewer = (): HTMLElement => document.querySelector("[data-audit-viewer]") as HTMLElement;
const button = (): HTMLButtonElement => document.querySelector("[data-audit-fullscreen]") as HTMLButtonElement;
const key = (k: string, target: EventTarget = document, init: KeyboardEventInit = {}): void => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }));
};

describe("audits.js", () => {
  beforeAll(async () => {
    document.body.innerHTML = `<input id="q"><select id="s"><option>f</option></select><div contenteditable id="e"></div>
      <div class="audits-viewer" data-audit-viewer>
        <div class="audits-fs"><button type="button" class="btn btn-sm" data-audit-fullscreen hidden>Fullscreen</button></div>
        <article class="markdown audits-doc"><h1>r</h1></article>
      </div>`;
    await import("../../app/assets/javascripts/audits.js");
  });

  it("shows the button once the script runs", () => {
    expect(button().hidden).toBe(false);
    expect(button().textContent).toBe("Fullscreen");
    expect(button().getAttribute("aria-pressed")).toBe("false");
  });

  it("toggles on the button", () => {
    button().click();
    expect(viewer().classList.contains("full")).toBe(true);
    expect(document.body.classList.contains("audit-reading")).toBe(true);
    expect(button().textContent).toBe("Exit fullscreen");
    button().click();
    expect(viewer().classList.contains("full")).toBe(false);
    expect(document.body.classList.contains("audit-reading")).toBe(false);
  });

  it("toggles on f, and Escape only leaves", () => {
    key("Escape");
    expect(viewer().classList.contains("full")).toBe(false);
    key("f");
    expect(viewer().classList.contains("full")).toBe(true);
    key("Escape");
    expect(viewer().classList.contains("full")).toBe(false);
  });

  it("leaves on Escape typed in a field", () => {
    key("f");
    key("Escape", document.getElementById("q") as HTMLElement);
    expect(viewer().classList.contains("full")).toBe(false);
  });

  it("ignores f typed into an input, select or editable, or with a modifier", () => {
    for (const id of ["q", "s", "e"]) key("f", document.getElementById(id) as HTMLElement);
    key("f", document, { ctrlKey: true });
    expect(viewer().classList.contains("full")).toBe(false);
  });
});
