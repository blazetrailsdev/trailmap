import { getFs } from "@blazetrails/ruby-compat";
import { Trails } from "@blazetrails/trailties";

/**
 * `DEPLOY_LOGS_DIR`, read once into `config.x` by config/application.ts: ringo's
 * pane-log directory, mounted read-only (docs/deploy.md).
 */
export function deployLogsDir(): string | null {
  const dir = (Trails.application!.config.x.deploys.logsDir as string | undefined)?.trim();
  return dir ? dir.replace(/\/+$/, "") : null;
}

/** A bare file name: what ringo records is a host path, and only its base is ours to read. */
const LOG_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._%-]*$/;

/**
 * One deploy run's log, read from the mount rather than through ringo — the
 * `pipe-pane` capture ringo's `DeployStore.LogText` reads (webhook/deploys.go).
 *
 * The capture stays raw only until ringo's sweep gzips it, so a finished run's
 * log is usually `<name>.gz`; both are read, raw first, as ringo does. That is
 * also the backfill: every run already finished has its file in the directory,
 * so there is nothing to copy.
 *
 * `null` when no directory is mounted or the name is not a bare file name,
 * which the controller answers by relaying ringo.
 */
export async function readDeployLog(logFile: string): Promise<{ text: string } | { missing: string } | null> {
  const dir = deployLogsDir();
  const name = logFile.slice(logFile.lastIndexOf("/") + 1);
  if (dir === null || !LOG_NAME_RE.test(name)) return null;
  const path = `${dir}/${name}`;
  try {
    return { text: await getFs().readFile(path, "utf-8") };
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  try {
    const gz = (await getFs().readFile(`${path}.gz`)) as Uint8Array;
    const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
    return { text: await new Response(stream).text() };
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  // ringo's wording, naming the path asked for rather than the `.gz` guessed.
  return { missing: `(pane log unreadable: ${path}: no such file or directory)` };
}
