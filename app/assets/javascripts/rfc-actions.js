/*
 * /rfc/<id>: the lifecycle buttons ask before they post, with the confirm
 * text ringo's page asked (`rfcStatusMoves`, webhook/rfcs.go:1158).
 */
for (const form of document.querySelectorAll("form[data-confirm]")) {
  form.addEventListener("submit", (event) => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  });
}
