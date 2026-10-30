/**
 * Which buttons `/story/<id>` offers, and so which of its POSTs it accepts.
 *
 * ringo's rules (`CanReady`, `CanTopQueue`, `CanClose`, `CanSpawn`,
 * webhook/story.go:134-146), over the stored status: the one `--from draft`
 * compares. `block` and `release` are trailmap's: ringo's page never had them.
 */
export interface StoryActions {
  ready: boolean;
  top: boolean;
  block: boolean;
  close: boolean;
  release: boolean;
  spawn: boolean;
}

export function storyActions(status: string | null, priority: number | null): StoryActions {
  const open = status !== "done" && status !== "closed";
  return {
    ready: status === "draft",
    top: (status === "draft" || status === "ready" || status === "blocked") && priority !== 0,
    block: open && status !== "blocked",
    close: open,
    release: status === "claimed",
    spawn: open,
  };
}
