// The RFC list's sort menu: choosing an option follows its link, so the
// default sort stays off the URL. Without JavaScript the form's button submits.
//
// Delegated from document: a module runs once per document, while Turbo Drive
// swaps <body> under it, so the listener finds the menu that is there when it
// changes. The visit goes through Drive when Turbo is loaded.
document.addEventListener("change", (event) => {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement) || !select.matches("select[data-sort-menu]")) return;
  const href = select.options[select.selectedIndex]?.dataset.href;
  if (!href) return;
  if (window.Turbo) window.Turbo.visit(href);
  else window.location.assign(href);
});
