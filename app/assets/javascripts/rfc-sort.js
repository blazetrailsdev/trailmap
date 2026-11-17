// The RFC list's sort menu: choosing an option follows its link, so the
// default sort stays off the URL. Without JavaScript the form's button submits.
for (const select of document.querySelectorAll("select[data-sort-menu]")) {
  select.addEventListener("change", () => {
    const href = select.selectedOptions[0]?.dataset.href;
    if (href) window.location.assign(href);
  });
}
