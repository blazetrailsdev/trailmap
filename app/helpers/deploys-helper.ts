import { HTTPS, InvalidURIError, URI } from "@blazetrails/ruby-compat";
import type { DeployRow } from "../controllers/deploys-controller.ts";

export const DeploysHelper = {
  /** Where a run's log is read: by id alone; the controller finds the file from the run. */
  deployLogPath(run: Pick<DeployRow, "id">): string {
    return `/deploys/log?id=${encodeURIComponent(run.id)}`;
  },

  /** The same log replayed through the terminal emulator, for the row's inline view. */
  deployScreenPath(run: Pick<DeployRow, "id">): string {
    return `/deploys/screen?id=${encodeURIComponent(run.id)}`;
  },

  /** A preview run's kind, for its tag: `preview`, `preview teardown`, `preview sweep`. Null for a deploy. */
  deployKind(run: Pick<DeployRow, "target">): string | null {
    const target = run.target ?? "";
    return target === "preview" || target.startsWith("preview ") ? target : null;
  },

  /**
   * A preview's address, linked only when it is an https URL: it is relayed
   * from ringo, which read it from a log.
   */
  deployPreviewUrl(run: Pick<DeployRow, "url">): string | null {
    try {
      const uri = URI.parse(run.url ?? "");
      return uri instanceof HTTPS && uri.host ? uri.toString() : null;
    } catch (error) {
      if (error instanceof InvalidURIError) return null;
      throw error;
    }
  },

  /** A run's length as ringo's page writes it: `42s`, `2m 5s`. */
  deployDuration(seconds: number): string {
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  },
};

