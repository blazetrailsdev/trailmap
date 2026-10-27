/**
 * Reading one file out of ringo's session archive, over the private network.
 *
 * The archive is on ringo's disk: transcripts ringo pinned, and pane logs
 * tmux appends to through the `pipe-pane` ringo armed (`armPaneLog`). trailmap
 * never arms a pipe — tmux allows one per pane, and a second writer is how
 * the archive gets corrupted — so it reads what is already there, through
 * ringo's `/sessions/file`, which hands back the bytes gunzipped.
 */

/**
 * A path under the archive root, as ringo's pages link it (`p=`): segments of
 * a file or directory name, joined by `/`. Stricter than ringo's `OpenPath`,
 * which cleans a path and checks the result stays under the root: here a
 * traversal, a dotfile, an absolute path, a backslash or an empty segment is
 * refused before anything is asked of ringo, so a refusal does not depend on
 * how ringo cleans.
 */
const ARCHIVE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._@+-]*$/;

/** Why `p` is refused, or `null` when it names an archive file. */
export function archivePathProblem(p: string): string | null {
  if (p === "") return "missing p";
  if (p.length > 1024) return "path is too long";
  const segments = p.split("/");
  for (const segment of segments) {
    if (segment === "") return `path "${p}" has an empty segment`;
    if (segment === "." || segment === "..") return `path "${p}" escapes the archive root`;
    if (segment.startsWith(".")) return `path "${p}" names a dotfile`;
    if (!ARCHIVE_SEGMENT.test(segment)) return `path "${p}" has a character the archive never writes`;
  }
  return null;
}

/** What a bounded read kept. */
export interface BoundedRead {
  bytes: Uint8Array;
  /** Bytes the stream carried in all, kept or not. */
  total: number;
  /** True when `total` exceeded the bound and `bytes` is only part of it. */
  truncated: boolean;
}

/**
 * Read at most `max` bytes of `body`, chunk by chunk, so nothing larger than
 * the bound is ever held.
 *
 * `keep: "head"` stops at the bound and cancels the rest of the stream — the
 * answer for a file served as is. `keep: "tail"` reads to the end and keeps
 * the LAST `max` bytes, as ringo's pane view does: the end of a session (how
 * it finished, or how it died) is the part worth seeing. Reading is async, so
 * a long stream costs the event loop nothing while it arrives.
 */
export async function readBounded(
  body: ReadableStream<Uint8Array>,
  max: number,
  keep: "head" | "tail",
): Promise<BoundedRead> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let held = 0;
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    chunks.push(value);
    held += value.length;
    if (keep === "head" && held > max) {
      await reader.cancel();
      break;
    }
    // Drop whole chunks off the front while the rest still covers the bound.
    while (keep === "tail" && held - chunks[0]!.length >= max) held -= chunks.shift()!.length;
  }
  const all = new Uint8Array(held);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  const truncated = total > max;
  const bytes = !truncated ? all : keep === "head" ? all.subarray(0, max) : all.subarray(held - max);
  return { bytes, total, truncated };
}
