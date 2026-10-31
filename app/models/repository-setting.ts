import { Hub } from "./hub.ts";
import type { Repository } from "./repository.ts";

/** The tabs a repository can turn off, in the order the nav renders them. */
export const OPTIONAL_TABS = [
  "issues",
  "pulls",
  "actions",
  "projects",
  "wiki",
  "insights",
] as const;
export type OptionalTab = (typeof OPTIONAL_TABS)[number];

/**
 * A repository's feature switches — GitHub's repo Settings → Features
 * checkboxes.
 *
 * These are load-bearing, not decoration: `/:owner/:repo/settings` is the page
 * that shows them, the tab nav renders only the enabled tabs, and a request for
 * a disabled tab is a 404. That is the whole reason the settings moved out of
 * the environment and into a table — an env string cannot be per-repo, cannot
 * be shown, and cannot be changed without a redeploy.
 *
 * Code and settings have no switch: a repository with no code tab is not a
 * repository, and a repository whose settings you cannot reach cannot be fixed.
 */
export class RepositorySetting extends Hub {
  static {
    this.belongsTo("repository");
    this.validates("repository_id", { presence: true, uniqueness: true });
  }

  /**
   * Whether `tab` is on. An unknown tab — `code`, `settings`, a typo — is ON:
   * the switches are an opt-OUT, and a tab nobody can turn off must not become
   * unreachable because it has no column.
   */
  enabled(tab: string): boolean {
    if (!(OPTIONAL_TABS as readonly string[]).includes(tab)) return true;
    return Boolean(this[`${tab}_enabled` as keyof RepositorySetting]);
  }
}

/** What a page needs of the switches: one question, asked per tab. */
export interface TabSwitches {
  enabled(tab: string): boolean;
}

/**
 * The switches a repository with NO settings row gets: everything on.
 *
 * A missing row is not an error — `importFleetRepos` writes one, but a repo
 * created by hand or by a backfill may not have one yet, and a tab that 404s
 * for want of a row would look exactly like a tab someone turned off. Not a
 * `RepositorySetting` instance: building one reflects columns, and this is
 * reached on the no-connection path.
 */
export const ALL_TABS_ENABLED: TabSwitches = { enabled: () => true };
