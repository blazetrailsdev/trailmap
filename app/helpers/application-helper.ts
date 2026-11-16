import { getFs } from "@blazetrails/ruby-compat";

const headerSections: Record<string, unknown> = JSON.parse(
  await getFs().readFile("config/header-sections.json", "utf8"),
);

/**
 * How a header link is marked on the page at `current`: `page` on an exact
 * match, `section` on a page inside the link's section (paths under its own,
 * and those `config/header-sections.json` lists), else `null`. Rails'
 * `nav_mark` reads the same file.
 */
export function navMark(path: string, current: string): "page" | "section" | null {
  const here = current.length > 1 ? current.replace(/\/+$/, "") : current;
  if (here === path) return "page";
  const extra = headerSections[path];
  const prefixes = [path + "/", ...(Array.isArray(extra) ? (extra as string[]) : [])];
  return prefixes.some((prefix) => here.startsWith(prefix)) ? "section" : null;
}

export const ApplicationHelper = {
  /** `navMark` for the request this view renders. */
  navMarkHere(this: { request: { path: string } }, path: string): "page" | "section" | null {
    return navMark(path, this.request.path);
  },

  /**
   * The word a status badge shows, and the suffix of its `s-` class. A status
   * is whatever the record holds, so a null or blank one is `unknown` — the
   * arm ringo renders for a dep whose RFC is missing
   * (`webhook/story.go:551,684`).
   */
  statusWord(status: unknown): string {
    return String(status ?? "").trim() || "unknown";
  },
};
