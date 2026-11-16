import { getFs } from "@blazetrails/ruby-compat";

// Anchored to this file, not the working directory, as Rails' copy is to
// `Rails.root`.
const headerSections: Record<string, unknown> = JSON.parse(
  await getFs().readFile(decodeURIComponent(new URL("../../config/header-sections.json", import.meta.url).pathname), "utf8"),
);

const unescape = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

type NavRequest = { path: string; method: string };

export const ApplicationHelper = {
  /**
   * How a header link is marked: `page` on an exact match, `section` on a page
   * inside the link's section (paths under its own, and those
   * `config/header-sections.json` lists), else `null`. `current` defaults to
   * the request's path, and then, as `current_page?` does, only a GET or HEAD
   * is marked. Both sides are unescaped before comparing. Rails' `nav_mark`
   * has the same shape and reads the same file.
   */
  navMark(this: { request?: NavRequest } | void, path: string, current?: string): "page" | "section" | null {
    if (current === undefined) {
      const request = (this as { request?: NavRequest } | undefined)?.request;
      if (!request) {
        throw new Error("You cannot use helpers that need to determine the current page unless your view context provides a Request object in a #request method");
      }
      if (!["GET", "HEAD"].includes(request.method.toUpperCase())) return null;
      current = request.path;
    }
    const target = unescape(path);
    let here = unescape(current);
    if (here.length > 1) here = here.replace(/\/+$/, "");
    if (here === target) return "page";
    const extra = headerSections[path];
    const prefixes = [target + "/", ...(Array.isArray(extra) ? (extra as string[]) : [])];
    return prefixes.some((prefix) => here.startsWith(prefix)) ? "section" : null;
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
