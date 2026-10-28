import { getFs } from "@blazetrails/ruby-compat";
import { Trails } from "@blazetrails/trailties";

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
  const path = `${deployLogsDir()}/${deployLogName(logFile)}`;
  try {
    return await getFs().readFile(path, "utf-8");
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  try {
    const gz = new Uint8Array(await getFs().readFile(`${path}.gz`));
    const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  // ringo's wording, naming the path asked for rather than the `.gz` guessed.
  return `(pane log unreadable: ${path}: no such file or directory)`;
}
