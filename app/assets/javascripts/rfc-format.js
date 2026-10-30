/** The message a relay's success shows. `data` is null when the answer was not JSON. */
export function relayed(path, data) {
  if (path === "spawnloop/rfc-batch-spawn") {
    const ids = (data && data.stories) || [];
    return `Spawned ${ids.length} stor${ids.length === 1 ? "y" : "ies"} in pane ${(data && data.pane) || "?"}: ${ids.join(", ")}`;
  }
  if (path === "spawnloop/story-spawn") return `Spawned ${(data && data.story) || "story"} in pane ${(data && data.pane) || "?"}`;
  return "Agent spawned — its summary will appear on ringo's Refinements tab when it finishes.";
}

/** The relay's body: the button's payload, with the operator's note if it carries one. */
export function relayBody(payload, note) {
  const body = JSON.parse(payload);
  return JSON.stringify("note" in body ? { ...body, note } : body);
}
