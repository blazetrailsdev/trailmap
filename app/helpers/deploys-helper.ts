import type { DeployRow } from "../controllers/deploys-controller.ts";

export const DeploysHelper = {
  /**
   * Where a run's log is read: the id, and the base name of the capture ringo
   * recorded, which `DeploysController#log` reads off the mount.
   */
  deployLogPath(run: Pick<DeployRow, "id" | "logFile">): string {
    const file = run.logFile ? run.logFile.slice(run.logFile.lastIndexOf("/") + 1) : "";
    return `/deploys/log?id=${encodeURIComponent(run.id)}` + (file ? `&file=${encodeURIComponent(file)}` : "");
  },

  /** A run's length as ringo's page writes it: `42s`, `2m 5s`. */
  deployDuration(seconds: number): string {
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  },
};
