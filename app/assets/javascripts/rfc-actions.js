import { relayBody, relayed } from "./rfc-format.js";

/*
 * /rfc/<id> and /story/<id>: the lifecycle buttons ask before they post, with the confirm
 * text ringo's page asked (`rfcStatusMoves`, webhook/rfcs.go:1158).
 */
for (const form of document.querySelectorAll("form[data-confirm]")) {
  form.addEventListener("submit", (event) => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  });
}

/*
 * "Spawn batch", "Refine stories" and "Sunset" start an agent, which is ringo's dispatch: they
 * post through trailmap's `fleet/control` relay with ringo's own payload and
 * confirm text (webhook/rfcs.go), and show ringo's answer — its error text
 * verbatim when it refuses or cannot be reached.
 * /story/<id>'s "Spawn worker" is the same relay.
 */
const relayStatus = document.querySelector("[data-relay-status]");
const relayButtons = document.querySelectorAll("button[data-relay]");
const relayNote = document.querySelector("[data-relay-note]");

function showRelay(text, failed) {
  relayStatus.textContent = text;
  relayStatus.classList.toggle("err", failed);
  relayStatus.hidden = text === "";
}

for (const button of relayButtons) {
  button.addEventListener("click", async () => {
    if (!window.confirm(button.dataset.confirm)) return;
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
}
