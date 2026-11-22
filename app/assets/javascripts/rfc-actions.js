import { relayBody, relayed } from "./rfc-format.js";

// Every listener is delegated from document and looks its elements up when the
// event fires: a module runs once per document, while Turbo Drive swaps <body>
// under it, so anything bound to an element at load would be bound to a page
// that is gone.

/*
 * /rfc/<id> and /story/<id>: the lifecycle buttons ask before they post, with the confirm
 * text ringo's page asked (`rfcStatusMoves`, webhook/rfcs.go:1158).
 */
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.dataset.confirm === undefined) return;
  if (!window.confirm(form.dataset.confirm)) event.preventDefault();
});

/*
 * "Spawn batch", "Refine stories" and "Sunset" start an agent, which is ringo's dispatch: they
 * post through trailmap's `fleet/control` relay with ringo's own payload and
 * confirm text (webhook/rfcs.go), and show ringo's answer — its error text
 * verbatim when it refuses or cannot be reached.
 * /story/<id>'s "Spawn worker" is the same relay.
 */
function showRelay(text, failed) {
  const relayStatus = document.querySelector("[data-relay-status]");
  relayStatus.textContent = text;
  relayStatus.classList.toggle("err", failed);
  relayStatus.hidden = text === "";
}

document.addEventListener("click", async (event) => {
  const button = event.target instanceof Element ? event.target.closest("button[data-relay]") : null;
  if (!button) return;
  if (!window.confirm(button.dataset.confirm)) return;
  const relayButtons = document.querySelectorAll("button[data-relay]");
  const relayNote = document.querySelector("[data-relay-note]");
  const meta = document.querySelector('meta[name="csrf-token"]');
  for (const b of relayButtons) b.disabled = true;
  showRelay("Spawning…", false);
  try {
    const response = await fetch(`/fleet/control/${button.dataset.relay}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(meta ? { "X-CSRF-Token": meta.content } : {}) },
      body: relayBody(button.dataset.payload, relayNote ? relayNote.value : ""),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text.trim() || response.statusText);
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // rfc-refine answers with no JSON body; only the batch reports stories.
    }
    showRelay(relayed(button.dataset.relay, data), false);
    // As ringo's page: a second pass starts from fresh instructions.
    if (relayNote) relayNote.value = "";
  } catch (error) {
    showRelay(String(error.message || error), true);
  }
  for (const b of relayButtons) b.disabled = false;
});

// The priority select submits on change, as ringo's does; <noscript> keeps a Set button.
document.addEventListener("change", (event) => {
  const select = event.target;
  if (select instanceof HTMLSelectElement && select.matches("select[data-autosubmit]")) select.form?.requestSubmit();
});
