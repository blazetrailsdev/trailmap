/*
 * /audits fullscreen, as ringo's Audits page has it (webhook/audits.go): the
 * open report lifts out of the layout and covers the viewport, so the list and
 * nav stop competing with the reading column. The button, `f`, or Escape puts
 * it back.
 *
 * The page's own fullscreen, not the browser's: the native API would hand the
 * keyboard to a framed report's document. That document is sandboxed to an
 * opaque origin, so unlike ringo this page cannot bind the key inside it —
 * once you click into an html report, the button is the way out.
 */
const viewer = document.querySelector("[data-audit-viewer]");
const button = viewer?.querySelector("[data-audit-fullscreen]");

function paint(full) {
  viewer.classList.toggle("full", full);
  document.body.classList.toggle("audit-reading", full);
  button.textContent = full ? "Exit fullscreen" : "Fullscreen";
  button.title = full ? "Back to the list (Esc, or f)" : "Fill the window with this report (f)";
  button.setAttribute("aria-pressed", String(full));
}

function toggle() {
  paint(!viewer.classList.contains("full"));
}

if (viewer && button) {
  paint(false);
  button.hidden = false;
  button.addEventListener("click", toggle);
  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape" && viewer.classList.contains("full")) {
      toggle();
      return;
    }
    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      toggle();
    }
  });
}
