import type { DeployRow } from "../controllers/deploys-controller.ts";

export const DeploysHelper = {
  /** Where a run's log is read: by id alone; the controller finds the file from the run. */
  deployLogPath(run: Pick<DeployRow, "id">): string {
    return `/deploys/log?id=${encodeURIComponent(run.id)}`;
  },

  /** A run's length as ringo's page writes it: `42s`, `2m 5s`. */
  deployDuration(seconds: number): string {
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  },
};
