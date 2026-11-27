// The RFC list's sort menu: choosing an option follows its link, so the
// default sort stays off the URL. Without JavaScript the form's button submits.
//
// Turbo Drive swaps <body>, and this module runs once per document, so it binds
// on every `turbo:load` as well as now. `bound` keeps an element that both
// reach from being bound twice: a WeakSet, not an attribute, because Turbo's
// snapshot cache clones <body> and a clone keeps attributes but no listeners.
const bound = new WeakSet();

function bind() {
  for (const select of document.querySelectorAll("select[data-sort-menu]")) {
    if (bound.has(select)) continue;
    bound.add(select);
    select.addEventListener("change", () => {
      const href = select.options[select.selectedIndex]?.dataset.href;
      if (!href) return;
      if (window.Turbo) window.Turbo.visit(href);
      else window.location.assign(href);
    });
  }
}

bind();
document.addEventListener("turbo:load", bind);
