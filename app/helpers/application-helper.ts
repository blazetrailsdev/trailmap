import { previewPr } from "../../config/preview.ts";
import { getFs } from "@blazetrails/ruby-compat";
import { Trails } from "@blazetrails/trailties";

// Anchored to the application root, as Rails' copy is to `Rails.root`, not
// to this file's URL: under a DOM test environment that URL is not a file.
const headerSections: Record<string, unknown> = JSON.parse(
  await getFs().readFile(`${Trails.root()}/config/header-sections.json`, "utf8"),
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
  /** The PR a preview app serves, for the layout's banner; null in production. */
  previewPr(): number | null {
    return previewPr();
  },

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
    const strip = (value: string): string => (value.length > 1 ? value.replace(/\/+$/, "") : value);
    const target = strip(unescape(path));
    const here = strip(unescape(current));
    if (here === target) return "page";
    const extra = headerSections[target];
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
