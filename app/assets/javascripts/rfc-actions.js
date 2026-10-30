/*
 * /rfc/<id>: the lifecycle buttons ask before they post, with the confirm
 * text ringo's page asked (`rfcStatusMoves`, webhook/rfcs.go:1158).
 */
for (const form of document.querySelectorAll("form[data-confirm]")) {
  form.addEventListener("submit", (event) => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  });
}

/*
 * "Spawn batch" and "Sunset" start an agent, which is ringo's dispatch: they
 * post through trailmap's `fleet/control` relay with ringo's own payload and
 * confirm text (webhook/rfcs.go), and show ringo's answer — its error text
 * verbatim when it refuses or cannot be reached.
 */
const relayStatus = document.querySelector("[data-relay-status]");
const relayButtons = document.querySelectorAll("button[data-relay]");

function showRelay(text, failed) {
  relayStatus.textContent = text;
  relayStatus.classList.toggle("err", failed);
  relayStatus.hidden = text === "";
}

function relayed(path, data) {
  if (path === "spawnloop/rfc-batch-spawn") {
    const ids = (data && data.stories) || [];
    return `Spawned ${ids.length} stor${ids.length === 1 ? "y" : "ies"} in pane ${data.pane || "?"}: ${ids.join(", ")}`;
  }
  return "Agent spawned — its summary will appear on ringo's Refinements tab when it finishes.";
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
        body: button.dataset.payload,
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
    } catch (error) {
      showRelay(String(error.message || error), true);
    }
    for (const b of relayButtons) b.disabled = false;
  });
}
