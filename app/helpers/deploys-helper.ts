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
   * from ringo, which read it from a log, and an href is no place to trust
   * that blindly.
   */
  deployPreviewUrl(run: Pick<DeployRow, "url">): string | null {
    if (!run.url) return null;
    // WHATWG parsing is more lenient than Ruby's URI: it accepts `https:host`
    // and trims whitespace around the input, both of which Rails rejects.
    if (/\s/.test(run.url) || !/^https:\/\/[^/?#]/i.test(run.url)) return null;
    try {
      // The URL as ringo sent it, not `url.href`: that normalizes (a lowercased
      // host, a trailing `/`), and Rails' `deploy_preview_url` prints the input
      // unchanged, so the two pages would link different hrefs for one row.
      return new URL(run.url).protocol === "https:" ? run.url : null;
    } catch {
      return null;
    }
  },

  /** A run's length as ringo's page writes it: `42s`, `2m 5s`. */
  deployDuration(seconds: number): string {
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  },
};
