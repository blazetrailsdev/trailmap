import { getFs } from "@blazetrails/ruby-compat";
import { Trails } from "@blazetrails/trailties";
import { renderPaneLog } from "../../lib/ringo-core.ts";

/**
 * `DEPLOY_LOGS_DIR`, read once into `config.x` by config/application.ts: ringo's
 * pane-log directory, mounted read-only (docs/deploy.md).
 */
export function deployLogsDir(): string {
  return String(Trails.application!.config.x.deploys.logsDir ?? "").trim().replace(/\/+$/, "");
}

/** A bare file name: what ringo records is a host path, and only its base is ours to read. */
const LOG_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._%-]*$/;

/** The base name of the capture ringo recorded. */
export function deployLogName(logFile: string): string {
  return logFile.slice(logFile.lastIndexOf("/") + 1);
}

/**
 * Whether `logFile` is read off the mount: one is mounted, and the name is a
 * bare file name. Otherwise the controller relays ringo.
 */
export function readsDeployLogLocally(logFile: string): boolean {
  return deployLogsDir() !== "" && LOG_NAME_RE.test(deployLogName(logFile));
}

/**
 * One deploy run's log, read from the mount rather than through ringo — the
 * `pipe-pane` capture ringo's `DeployStore.LogText` reads (webhook/deploys.go).
 *
 * The capture stays raw only until ringo's sweep gzips it, so a finished run's
 * log is usually `<name>.gz`; both are read, raw first, as ringo does. That is
 * also the backfill: every run already finished has its file in the directory,
 * so there is nothing to copy.
 * Ask `readsDeployLogLocally` first. A missing file answers ringo's
 * "unreadable" line, as ringo's page shows it.
 */
export async function readDeployLog(logFile: string): Promise<string> {
  return new TextDecoder().decode(await readDeployLogBytes(logFile));
}

/**
 * `readDeployLog`'s bytes, undecoded: a tty capture can hold invalid or split
 * UTF-8, and the terminal emulator must see it as written (as Rails' `.b`
 * does), not after a decode has replaced it with U+FFFD.
 */
export async function readDeployLogBytes(logFile: string): Promise<Uint8Array> {
  const path = `${deployLogsDir()}/${deployLogName(logFile)}`;
  try {
    return new Uint8Array(await getFs().readFile(path));
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  try {
    const gz = new Uint8Array(await getFs().readFile(`${path}.gz`));
    const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  // ringo's wording, naming the path asked for rather than the `.gz` guessed.
  return new TextEncoder().encode(`(pane log unreadable: ${path}: no such file or directory)`);
}

/**
 * A deploy log replayed through ringo's terminal emulator, within the bounds
 * the caller passes (the pane view's): the tail of the capture, at most its rows kept, so one
 * request's work is capped however long the deploy ran. An emulator failure
 * comes back as a `problem` to answer in plain text, as a relay failure is.
 */
export async function deployScreen(
  bytes: Uint8Array,
  maxBytes: number,
  maxLines: number,
  render: typeof renderPaneLog = renderPaneLog,
): Promise<{ html: string } | { problem: string }> {
  const tail = bytes.length > maxBytes ? bytes.subarray(bytes.length - maxBytes) : bytes;
  try {
    return { html: (await render(tail, maxLines)).html };
  } catch (error) {
    return { problem: `log not rendered: ${(error as Error).message}` };
  }
}

/**
 * `DeployLog`, the constant Zeitwerk requires this file to define (RFC 0213): a Ruby
 * module of `module_function`s, bundling the named exports above.
 */
export const DeployLog = {
  deployLogName,
  deployLogsDir,
  readDeployLog,
  readDeployLogBytes,
  deployScreen,
  readsDeployLogLocally,
};
