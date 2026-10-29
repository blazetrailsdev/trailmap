/**
 * Move an RFC through its lifecycle — draft ⇄ active, or out to closed /
 * postponed — and promote its draft stories in one batch.
 *
 * A port of the CLI's `tasks rfc-status` (tasks/src/rfc-status.ts), which
 * ringo's RFC page shelled out to (`HandleRFCStatus`, btwebooks
 * webhook/rfcs.go:1180). It is a MARKDOWN act: an RFC's `status:` is
 * markdown-owned, so the frontmatter is rewritten, committed and pushed. The
 * refusals and their messages are the CLI's, raised as `VerbExit`.
 *
 * INGEST is the row write and the `rfc-status` event. The CLI runs a full
 * `ingest` after the commit. For an existing RFC, ingest's `upsertRfc`
 * (tasks/src/ingest.ts:471-499) rewrites every frontmatter column, and of
 * those only `status` and `updated` changed in this commit, then re-applies
 * `closeRfcIfComplete`. trailmap has no port of ingest, so it writes those
 * two columns and runs that rule; the next ingest reads the same file and
 * writes the same values, so nothing is reverted.
 *
 * The commit and push come BEFORE that row write, and nothing rolls one back
 * when the other fails: git and SQLite share no transaction. If the row write
 * throws after the push, the markdown is ahead of the row until the next
 * ingest, which projects the committed file and closes the gap. That is the
 * CLI's order and its recovery too (it commits, then ingests).
 *
 * Moves are serialized per checkout (`withCheckoutLock`): two clicks at once
 * would otherwise race on the file and the index, and the commit-failure
 * cleanup (`checkout -- rel`) could discard the other request's edit. The lock
 * is per process — trailmap serves the page from one.
 */
import { Open3, getFs, getPath } from "@blazetrails/ruby-compat";
import { tasksContentDir } from "../../config/tasks-content.ts";
import { ApplicationRecord } from "./application-record.ts";
import { Event } from "./event.ts";
import { closeRfcIfComplete } from "./rfc-close.ts";
import { RFC_STATUSES, Rfc, type RfcStatus } from "./rfc.ts";
import { Story } from "./story.ts";
import { VerbExit } from "./verb-exit.ts";

/**
 * The transitions the CLI makes (`ALLOWED`, rfc-status.ts). `superseded` is
 * absent: it needs a `superseded-by` target, an authoring decision. Reopening
 * a closed RFC is a PR, not a button.
 */
const ALLOWED: Record<RfcStatus, readonly RfcStatus[]> = {
  draft: ["active", "closed", "postponed"],
  active: ["draft", "closed", "postponed"],
  postponed: ["draft", "active", "closed"],
  closed: [],
  superseded: [],
};

const TERMINAL_STORY = new Set(["done", "closed"]);

export interface RfcStatusMove {
  to: RfcStatus;
  label: string;
  confirm: string;
}

const READY: RfcStatusMove = {
  to: "active",
  label: "Mark ready",
  confirm: "Mark this RFC ready (active)? Its ready stories become pickable by the spawn loop.",
};
const DRAFT: RfcStatusMove = {
  to: "draft",
  label: "Back to draft",
  confirm: "Move this RFC back to draft? Its stories stop being picked up.",
};
const POSTPONE: RfcStatusMove = {
  to: "postponed",
  label: "Postpone",
  confirm: "Postpone this RFC? Its stories stop being picked up until it is made ready again.",
};
const CLOSE: RfcStatusMove = {
  to: "closed",
  label: "Close RFC",
  confirm: "Close this RFC? Refused while any of its stories are unfinished — use Sunset for that.",
};

/** ringo's `rfcStatusMoves` (rfcs.go:1158): the buttons, in its order. */
export function rfcStatusMoves(status: string): RfcStatusMove[] {
  switch (status) {
    case "draft":
      return [READY, POSTPONE, CLOSE];
    case "active":
      return [DRAFT, POSTPONE, CLOSE];
    case "postponed":
      return [READY, DRAFT, CLOSE];
  }
  return [];
}

const checkoutLocks = new Map<string, Promise<unknown>>();

/** Run `work` after every earlier move on the same checkout has finished. */
async function withCheckoutLock<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const previous = checkoutLocks.get(dir) ?? Promise.resolve();
  const run = previous.catch(() => null).then(work);
  checkoutLocks.set(dir, run);
  try {
    return await run;
  } finally {
    if (checkoutLocks.get(dir) === run) checkoutLocks.delete(dir);
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `git <args>` in `dir`. Arguments reach the shell as variables, never spliced. */
async function git(dir: string, ...args: string[]): Promise<string> {
  const vars: Record<string, string> = { RFC_STATUS_DIR: dir };
  args.forEach((arg, i) => (vars[`RFC_STATUS_ARG${i}`] = arg));
  const argv = args.map((_, i) => `"$RFC_STATUS_ARG${i}"`).join(" ");
  const [output, status] = await Open3.capture2e(vars, `git -C "$RFC_STATUS_DIR" ${argv}`);
  if (!status.isSuccess()) throw new Error(`git ${args[0]}: ${output.trim()}`);
  return output.trim();
}

/**
 * The CLI's `editFrontmatter` for single-line scalar keys, refusing a key
 * whose value is an indented list as it does.
 */
function editFrontmatter(text: string, rel: string, edits: Record<string, string>): string {
  const m = /^(---\n)([\s\S]*?)(\n---\n)([\s\S]*)$/.exec(text);
  if (!m) throw new VerbExit(1, `${rel} has no frontmatter block`);
  const lines = m[2]!.split("\n");
  for (const [key, value] of Object.entries(edits)) {
    const i = lines.findIndex((line) => new RegExp(`^${key}:(\\s|$)`).test(line));
    if (i === -1) {
      lines.push(`${key}: ${value}`);
      continue;
    }
    if (lines[i + 1] && /^[ \t]/.test(lines[i + 1]!)) {
      throw new VerbExit(1, `refusing to edit list-valued frontmatter key "${key}" in ${rel}`);
    }
    lines[i] = `${key}: ${value}`;
  }
  return m[1] + lines.join("\n") + m[3] + m[4];
}

/**
 * `tasks rfc-status <id> <status> [--reason R]`. Returns the CLI's line.
 *
 * The push is the CLI's `pushMain`: push, else rebase onto origin and push
 * again, else keep the local commit and say so — a commit the next run will
 * push is not a failed move. Unlike `pushMain`, a rebase that stops on a
 * conflict is aborted: the CLI leaves the checkout mid-rebase for a person at
 * a terminal to resolve, and a page has no terminal, so every later click
 * would be refused as "a detached HEAD" with no way out from the page.
 */
export async function rfcStatusSet(id: string, to: string, opts: { reason?: string | null } = {}): Promise<string> {
  const dir = tasksContentDir();
  if (dir === null) throw new VerbExit(1, "TASKS_DIR names no tasks checkout");
  return withCheckoutLock(dir, () => moveRfc(dir, id, to, opts.reason ?? null));
}

async function moveRfc(dir: string, id: string, to: string, rawReason: string | null): Promise<string> {
  if (!(RFC_STATUSES as readonly string[]).includes(to)) {
    throw new VerbExit(1, `unknown RFC status "${to}" (one of: ${RFC_STATUSES.join(", ")})`);
  }
  const target = to as RfcStatus;

  const branch = await git(dir, "rev-parse", "--abbrev-ref", "HEAD").catch(() => null);
  if (branch !== "main") {
    throw new VerbExit(
      1,
      `${dir} is on ${branch && branch !== "HEAD" ? branch : "a detached HEAD"}, not main — refusing to set rfc status.`,
    );
  }

  const rfc = await Rfc.findBy({ id });
  if (!rfc) throw new VerbExit(1, `no such RFC "${id}"`);
  const from = rfc.status;
  if (from === target) return `rfc ${id} already ${target}`;
  if (!ALLOWED[from]?.includes(target)) {
    throw new VerbExit(1, `RFC ${id} is ${from} — cannot move it to ${target}.`);
  }

  if (target === "closed") {
    const open = (await Story.where({ rfc_id: id }).toArray()).filter((s) => !TERMINAL_STORY.has(s.status));
    if (open.length > 0) {
      const shown = open.slice(0, 5).map((s) => s.id).join(", ");
      throw new VerbExit(
        1,
        `RFC ${id} still has ${open.length} unfinished stor${open.length === 1 ? "y" : "ies"} ` +
          `(${shown}${open.length > 5 ? ", …" : ""}) — close or rehome them first, or sunset the RFC.`,
      );
    }
  }

  const fs = getFs();
  const rel = rfc.file_path ?? getPath().join("rfcs", id, "README.md");
  const abs = getPath().join(dir, rel);
  if (!fs.writeFile || !fs.readFile || !(await fs.exists(abs))) throw new VerbExit(1, `${rel} does not exist`);
  const updated = today();
  await fs.writeFile(abs, editFrontmatter(await fs.readFile(abs, "utf8"), rel, { status: target, updated }));

  // Blank is absent, in the commit message and in the event alike.
  const reason = rawReason?.trim() || null;
  try {
    await git(dir, "add", "--", rel);
    await git(dir, "commit", "-q", "-m", `rfc(${id}): ${from} -> ${target}${reason ? `\n\n${reason}` : ""}`);
  } catch (error) {
    // Put the file back, index and worktree, so a failed commit leaves no
    // edit for the next click to autostash or commit.
    await git(dir, "reset", "-q", "--", rel).catch(() => null);
    await git(dir, "checkout", "--", rel).catch(() => null);
    throw new VerbExit(1, `rfc-status could not commit ${rel}: ${(error as Error).message}`);
  }
  let line = `rfc ${id}: ${from} -> ${target}`;
  try {
    await git(dir, "push", "--quiet", "origin", "HEAD:main");
  } catch {
    try {
      await git(dir, "pull", "--rebase", "--autostash", "--quiet", "origin", "main");
      await git(dir, "push", "--quiet", "origin", "HEAD:main");
    } catch (error) {
      await git(dir, "rebase", "--abort").catch(() => null);
      line +=
        `\nwarning: rfc-status committed locally but could not push: ${(error as Error).message}\n` +
        `  the work is on local main; push it or the next run will.`;
    }
  }

  await ApplicationRecord.transaction(async () => {
    await rfc.update({ status: target, updated_on: updated });
    await Event.create({
      at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      verb: "rfc-status",
      story_id: null,
      rfc_id: id,
      pr: null,
      actor: null,
      detail: JSON.stringify({ from, to: target, note: reason }),
    });
    // What ingest does next for an RFC whose status it projects
    // (tasks/src/ingest.ts:492-499): a now-active RFC with nothing left open
    // closes again.
    await closeRfcIfComplete(id);
  });
  return line;
}

/**
 * ringo's `HandleRFCReadyDrafts` (rfcs.go:1272): every draft story under the
 * RFC to `ready`, through `Story.statusSetAll(..., { from: "draft" })` — the
 * CLI's `status-set <id...> ready --from draft`, all or nothing.
 */
export async function rfcReadyDrafts(id: string): Promise<string[]> {
  const rfc = await Rfc.findBy({ id });
  if (!rfc) throw new VerbExit(1, `no such RFC "${id}"`);
  const drafts = (await Story.where({ rfc_id: id, status: "draft" }).toArray()).map((s) => s.id);
  if (drafts.length === 0) throw new VerbExit(2, `rfc ${id} has no draft stories`);
  return Story.statusSetAll(drafts, "ready", { from: "draft" });
}
